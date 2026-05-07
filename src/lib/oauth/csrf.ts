import { timingSafeEqual } from "node:crypto";

import { randomToken } from "./crypto";

export const OAUTH_CSRF_COOKIE_NAME = "alex_oauth_csrf";
export const OAUTH_CSRF_MAX_AGE_SECONDS = 10 * 60;

export function createOauthCsrfToken() {
  return randomToken(32);
}

export function verifyOauthCsrfToken(
  cookieToken: string | null | undefined,
  formToken: string | null | undefined,
) {
  if (!cookieToken || !formToken) {
    return false;
  }

  const cookieBuffer = Buffer.from(cookieToken);
  const formBuffer = Buffer.from(formToken);

  if (cookieBuffer.length !== formBuffer.length) {
    return false;
  }

  return timingSafeEqual(cookieBuffer, formBuffer);
}

export function oauthCsrfCookieOptions(maxAge = OAUTH_CSRF_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    maxAge,
    path: "/oauth/authorize",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

export function clearOauthCsrfCookieOptions() {
  return oauthCsrfCookieOptions(0);
}

export function serializeOauthCsrfCookie(value: string, maxAge?: number) {
  const options = oauthCsrfCookieOptions(maxAge);
  const parts = [
    `${OAUTH_CSRF_COOKIE_NAME}=${value}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
  ];

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function clearOauthCsrfCookie() {
  return serializeOauthCsrfCookie("", 0);
}

export function readCookieValue(cookieHeader: string | null, cookieName: string) {
  if (!cookieHeader) {
    return null;
  }

  for (const cookiePair of cookieHeader.split(";")) {
    const [name, ...valueParts] = cookiePair.trim().split("=");

    if (name === cookieName) {
      return valueParts.join("=");
    }
  }

  return null;
}
