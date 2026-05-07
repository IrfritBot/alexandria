import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("OAuth protected resource metadata route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns MCP protected-resource metadata from request origin", async () => {
    const response = await GET(
      new Request("https://alexandria.test/.well-known/oauth-protected-resource"),
    );

    await expect(response.json()).resolves.toEqual({
      authorization_servers: ["https://alexandria.test"],
      resource: "https://alexandria.test/api/mcp",
      scopes_supported: ["memory:read", "memory:write"],
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("uses NEXT_PUBLIC_APP_URL when configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://alexandria.example");

    const response = await GET(
      new Request("http://localhost:3000/.well-known/oauth-protected-resource"),
    );

    await expect(response.json()).resolves.toMatchObject({
      authorization_servers: ["https://alexandria.example"],
      resource: "https://alexandria.example/api/mcp",
    });
  });
});
