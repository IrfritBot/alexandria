import { describe, expect, it } from "vitest";

import {
  getAuthorizeClientId,
  redirectWithOAuthResult,
  validateAuthorizeRequest,
} from "./authorize";

const client = {
  client_id: "alex_client_123",
  client_name: "Claude Desktop",
  redirect_uris: ["https://client.example/callback"],
};

function params(overrides: Record<string, string | undefined> = {}) {
  const searchParams = new URLSearchParams({
    client_id: client.client_id,
    code_challenge: "challenge",
    code_challenge_method: "S256",
    redirect_uri: client.redirect_uris[0],
    response_type: "code",
    state: "state-1",
  });

  for (const [key, value] of Object.entries(overrides)) {
    searchParams.delete(key);

    if (value !== undefined) {
      searchParams.set(key, value);
    }
  }

  return searchParams;
}

describe("OAuth authorize helpers", () => {
  it("extracts the requested client id", () => {
    expect(getAuthorizeClientId(params())).toBe(client.client_id);
    expect(getAuthorizeClientId(new URLSearchParams())).toBeNull();
  });

  it("validates authorization-code + PKCE requests and defaults scopes", () => {
    expect(validateAuthorizeRequest(params(), client)).toEqual({
      ok: true,
      request: {
        clientId: client.client_id,
        codeChallenge: "challenge",
        codeChallengeMethod: "S256",
        redirectUri: client.redirect_uris[0],
        responseType: "code",
        scope: "memory:read memory:write",
        scopes: ["memory:read", "memory:write"],
        state: "state-1",
      },
    });
  });

  it.each([
    ["response_type", "token", "unsupported_response_type"],
    ["client_id", "other-client", "invalid_request"],
    ["redirect_uri", "https://client.example/other", "invalid_request"],
    ["code_challenge", undefined, "invalid_request"],
    ["code_challenge_method", "plain", "invalid_request"],
    ["scope", "memory:read admin:write", "invalid_scope"],
  ] as const)("rejects invalid %s", (field, value, error) => {
    expect(validateAuthorizeRequest(params({ [field]: value }), client)).toMatchObject({
      error,
      field,
      ok: false,
    });
  });

  it("builds redirect_uri results while preserving state", () => {
    expect(
      redirectWithOAuthResult({
        code: "code-1",
        redirectUri: "https://client.example/callback?existing=1",
        state: "state-1",
      }),
    ).toBe("https://client.example/callback?existing=1&code=code-1&state=state-1");

    expect(
      redirectWithOAuthResult({
        error: "access_denied",
        redirectUri: "https://client.example/callback",
        state: "state-1",
      }),
    ).toBe("https://client.example/callback?error=access_denied&state=state-1");
  });
});
