import { describe, expect, it } from "vitest";

import { formatOauthScopes, hasScope, parseOauthScopes } from "./scopes";

describe("OAuth scopes", () => {
  it("defaults omitted scope to full MCP memory access", () => {
    expect(parseOauthScopes(null)).toEqual({
      ok: true,
      scopes: ["memory:read", "memory:write"],
    });
  });

  it("normalizes requested scopes and rejects unknown scopes", () => {
    expect(parseOauthScopes("memory:read memory:read memory:write")).toEqual({
      ok: true,
      scopes: ["memory:read", "memory:write"],
    });
    expect(parseOauthScopes("memory:read admin")).toEqual({
      invalidScopes: ["admin"],
      ok: false,
    });
    expect(formatOauthScopes(["memory:read", "admin", "memory:write"])).toBe(
      "memory:read memory:write",
    );
  });

  it("treats legacy API keys as full access and OAuth as scoped", () => {
    expect(hasScope({ authKind: "api_key" }, "memory:write")).toBe(true);
    expect(
      hasScope({ authKind: "oauth", scopes: ["memory:read"] }, "memory:read"),
    ).toBe(true);
    expect(
      hasScope({ authKind: "oauth", scopes: ["memory:read"] }, "memory:write"),
    ).toBe(false);
  });
});
