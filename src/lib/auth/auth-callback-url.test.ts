import { describe, expect, it } from "vitest";

import { buildAuthCallbackUrl } from "./auth-callback-url";

describe("buildAuthCallbackUrl", () => {
  it("builds an auth callback URL with a safe root fallback", () => {
    const url = new URL(
      buildAuthCallbackUrl("https://alexandria.test", null),
    );

    expect(url.origin).toBe("https://alexandria.test");
    expect(url.pathname).toBe("/auth/callback");
    expect(url.searchParams.get("next")).toBe("/");
  });

  it("preserves valid internal next paths", () => {
    const url = new URL(
      buildAuthCallbackUrl(
        "http://localhost:3000",
        "/workspaces/alexandria-demo/memories?q=pricing",
      ),
    );

    expect(url.toString()).toBe(
      "http://localhost:3000/auth/callback?next=%2Fworkspaces%2Falexandria-demo%2Fmemories%3Fq%3Dpricing",
    );
    expect(url.searchParams.get("next")).toBe(
      "/workspaces/alexandria-demo/memories?q=pricing",
    );
  });

  it("rejects malicious external next values", () => {
    const url = new URL(
      buildAuthCallbackUrl(
        "https://alexandria.test",
        "https://evil.example/callback",
      ),
    );

    expect(url.searchParams.get("next")).toBe("/");
  });

  it("preserves OAuth authorize continuations with validated redirect URIs", () => {
    const authorizeNext =
      "/oauth/authorize?client_id=alex_client_1&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&code_challenge=abc&code_challenge_method=S256";

    const url = new URL(
      buildAuthCallbackUrl("https://alexandria.test", authorizeNext),
    );

    expect(url.pathname).toBe("/auth/callback");
    expect(url.searchParams.get("next")).toBe(authorizeNext);
    expect(url.toString()).toContain(
      "redirect_uri%3Dhttps%253A%252F%252Fclient.example%252Fcallback",
    );
  });
});
