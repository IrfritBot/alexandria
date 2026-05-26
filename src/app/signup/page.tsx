import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AuthPanel } from "@/app/auth/_components/auth-panel";
import {
  firstSearchParamValue,
  getAuthPageState,
  getAuthRequestOrigin,
} from "@/lib/auth/auth-page";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AuthPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignupPage({ searchParams }: AuthPageProps) {
  const queryParams = (await searchParams) ?? {};
  const requestHeaders = await headers();
  const supabase = await createSupabaseServerClient();
  const state = await getAuthPageState({
    origin: getAuthRequestOrigin(requestHeaders),
    rawNext: firstSearchParamValue(queryParams.next),
    supabase,
  });

  if (state.kind === "redirect") {
    redirect(state.location);
  }

  return (
    <AuthPanel
      callbackUrl={state.callbackUrl}
      initialError={firstSearchParamValue(queryParams.error)}
      mode="signup"
    />
  );
}
