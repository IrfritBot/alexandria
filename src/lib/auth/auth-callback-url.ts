import { getSafeNext } from "./safe-next";

export function buildAuthCallbackUrl(origin: string, rawNext: string | null) {
  const callbackUrl = new URL("/auth/callback", origin);

  callbackUrl.searchParams.set("next", getSafeNext(rawNext));

  return callbackUrl.toString();
}
