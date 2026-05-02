import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getSafeNext } from "../../../lib/auth/safe-next";
import { ensureProfile } from "../../../lib/profiles/ensure-profile";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

function redirectTo(requestUrl: URL, path: string) {
  return NextResponse.redirect(new URL(path, requestUrl.origin), 303);
}

function getDisplayName(user: User) {
  return user.user_metadata?.full_name ?? user.user_metadata?.name ?? null;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (!code) {
    return redirectTo(requestUrl, "/login?error=missing_code");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return redirectTo(requestUrl, "/login?error=exchange_failed");
  }

  const user = data.session?.user;

  if (!user?.email) {
    console.error("Profile sync failed: auth callback session had no email.");
    return redirectTo(requestUrl, "/login?error=profile_sync_failed");
  }

  const profileResult = await ensureProfile(
    {
      displayName: getDisplayName(user),
      email: user.email,
    },
    supabase,
  );

  if (!profileResult.ok) {
    console.error("Profile sync failed.", {
      reason: profileResult.reason,
    });
    return redirectTo(requestUrl, "/login?error=profile_sync_failed");
  }

  return redirectTo(requestUrl, getSafeNext(requestUrl.searchParams.get("next")));
}
