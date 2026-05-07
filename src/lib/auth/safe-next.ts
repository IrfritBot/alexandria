import { isValidRedirectUri } from "../oauth/clients";
import { parseOAuthScopes } from "../oauth/scopes";

function hasMalformedPercentEncoding(value: string) {
  return /%(?![0-9A-Fa-f]{2})/.test(value);
}

function hasUnsafeOauthParamKey(key: string) {
  if (key.includes(":") || key.includes("\\") || /\s/.test(key)) {
    return true;
  }

  try {
    const decodedKey = decodeURIComponent(key);

    return (
      decodedKey.includes(":") ||
      decodedKey.includes("\\") ||
      /\s/.test(decodedKey)
    );
  } catch {
    return false;
  }
}

function hasUnsafeOauthParamValue(value: string) {
  if (value.includes(":") || value.includes("//") || /\s/.test(value)) {
    return true;
  }

  try {
    const decodedValue = decodeURIComponent(value);

    return (
      decodedValue.includes(":") ||
      decodedValue.includes("//") ||
      /\s/.test(decodedValue)
    );
  } catch {
    return false;
  }
}

function isSafeOauthAuthorizeContinuation(next: string) {
  if (
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.includes("\\") ||
    hasMalformedPercentEncoding(next)
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
    if (hasUnsafeOauthParamKey(key)) {
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

    if (hasUnsafeOauthParamValue(value)) {
      return false;
    }
  }

  return true;
}

function decodeNext(rawNext: string) {
  try {
    return decodeURIComponent(rawNext);
  } catch {
    return null;
  }
}

function getSafeOauthAuthorizeNext(rawNext: string) {
  if (isSafeOauthAuthorizeContinuation(rawNext)) {
    return rawNext;
  }

  const next = decodeNext(rawNext);

  if (next && isSafeOauthAuthorizeContinuation(next)) {
    return next;
  }

  return null;
}

export function getSafeNext(rawNext: string | null): string {
  if (!rawNext) {
    return "/";
  }

  const oauthAuthorizeNext = getSafeOauthAuthorizeNext(rawNext);

  if (oauthAuthorizeNext) {
    return oauthAuthorizeNext;
  }

  const next = decodeNext(rawNext);

  if (
    !next ||
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
