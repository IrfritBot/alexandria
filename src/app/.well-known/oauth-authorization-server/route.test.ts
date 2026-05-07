import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("OAuth authorization server metadata route", () => {
  it("returns authorization-server discovery metadata", async () => {
    const response = await GET(
      new Request("https://alexandria.test/.well-known/oauth-authorization-server"),
    );

    await expect(response.json()).resolves.toEqual({
      authorization_endpoint: "https://alexandria.test/oauth/authorize",
      code_challenge_methods_supported: ["S256"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      issuer: "https://alexandria.test",
      registration_endpoint: "https://alexandria.test/oauth/register",
      response_types_supported: ["code"],
      scopes_supported: ["memory:read", "memory:write"],
      token_endpoint: "https://alexandria.test/oauth/token",
      token_endpoint_auth_methods_supported: ["none"],
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
