import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

function loginRedirect(request: Request, error?: string) {
  const url = new URL("/login", request.url);

  if (error) {
    url.searchParams.set("error", error);
  }

  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut();

    return loginRedirect(request, error ? "logout_failed" : undefined);
  } catch {
    return loginRedirect(request, "logout_failed");
  }
}
