import { isValidRedirectUri } from "../oauth/clients";
import { parseOAuthScopes } from "../oauth/scopes";

function isSafeOauthAuthorizeContinuation(next: string) {
  if (
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.includes("\\")
  ) {
    return false;
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(next, "https://alexandria.local");
  } catch {
    return false;
  }

  if (
    parsedUrl.origin !== "https://alexandria.local" ||
    parsedUrl.pathname !== "/oauth/authorize" ||
    parsedUrl.hash.length > 0
  ) {
    return false;
  }

  for (const [key, value] of parsedUrl.searchParams) {
    if (key.includes(":") || key.includes("\\") || /\s/.test(key)) {
      return false;
    }

    if (key === "redirect_uri") {
      if (!isValidRedirectUri(value)) {
        return false;
      }

      continue;
    }

    if (key === "scope") {
      if (/[\t\n\f\r\v]/.test(value) || !parseOAuthScopes(value).ok) {
        return false;
      }

      continue;
    }

    if (value.includes(":") || value.includes("//") || /\s/.test(value)) {
      return false;
    }
  }

  return true;
}

export function getSafeNext(rawNext: string | null): string {
  if (!rawNext) {
    return "/";
  }

  let next: string;

  try {
    next = decodeURIComponent(rawNext);
  } catch {
    return "/";
  }

  if (isSafeOauthAuthorizeContinuation(next)) {
    return next;
  }

  if (
    !next.startsWith("/") ||
    next.includes("//") ||
    next.includes("\\") ||
    // ":" rejection is intentional per the ALEX-002 plan, including in query strings.
    next.includes(":") ||
    /\s/.test(next) ||
    /^\/(?:api|auth|oauth)(?:\/|$)/i.test(next)
  ) {
    return "/";
  }

  return next;
}
