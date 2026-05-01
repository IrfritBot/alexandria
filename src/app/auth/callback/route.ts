import { NextResponse } from "next/server";

import { getSafeNext } from "../../../lib/auth/safe-next";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

type AuthUser = {
  email?: string | null;
  user_metadata?: {
    full_name?: string | null;
    name?: string | null;
  } | null;
};

function redirectTo(requestUrl: URL, path: string) {
  return NextResponse.redirect(new URL(path, requestUrl.origin), 303);
}

function getDisplayName(user: AuthUser) {
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

  const user = data.session?.user as AuthUser | undefined;

  if (!user?.email) {
    console.error("Profile sync failed: auth callback session had no email.");
    return redirectTo(requestUrl, "/login?error=profile_sync_failed");
  }

  const { error: profileError } = await supabase.rpc("ensure_profile", {
    p_display_name: getDisplayName(user),
    p_email: user.email,
  });

  if (profileError) {
    console.error("Profile sync failed.", profileError);
    return redirectTo(requestUrl, "/login?error=profile_sync_failed");
  }

  return redirectTo(requestUrl, getSafeNext(requestUrl.searchParams.get("next")));
}
