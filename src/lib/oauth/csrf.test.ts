import { describe, expect, it } from "vitest";

import {
  createOauthCsrfToken,
  OAUTH_CSRF_COOKIE_NAME,
  readCookieValue,
  serializeOauthCsrfCookie,
  verifyOauthCsrfToken,
} from "./csrf";

describe("OAuth CSRF helpers", () => {
  it("creates and verifies consent CSRF tokens", () => {
    const token = createOauthCsrfToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifyOauthCsrfToken(token, token)).toBe(true);
    expect(verifyOauthCsrfToken(token, `${token}x`)).toBe(false);
    expect(verifyOauthCsrfToken(null, token)).toBe(false);
  });

  it("serializes a short-lived HttpOnly consent cookie", () => {
    const cookie = serializeOauthCsrfCookie("token");

    expect(cookie).toContain(`${OAUTH_CSRF_COOKIE_NAME}=token`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/oauth/authorize");
    expect(readCookieValue(`a=1; ${cookie}`, OAUTH_CSRF_COOKIE_NAME)).toBe(
      "token",
    );
  });
});
