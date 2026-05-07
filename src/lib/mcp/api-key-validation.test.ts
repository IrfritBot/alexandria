import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { validateMcpApiKey, validateMcpBearerToken } from "./api-key-validation";

vi.mock("server-only", () => ({}));

const VALID_API_KEY = `alex_abcdef12_${"0".repeat(32)}`;

describe("MCP API-key validation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps a valid presented key only to the verified key workspace", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          id: "mcp-key-1",
          workspace_id: "workspace-1",
        },
      ],
      error: null,
    }));

    await expect(validateMcpApiKey(VALID_API_KEY, { rpc })).resolves.toEqual({
      ok: true,
      session: {
        authKind: "api_key",
        keyPrefix: "abcdef12",
        mcpKeyId: "mcp-key-1",
        workspaceId: "workspace-1",
      },
    });
    expect(rpc).toHaveBeenCalledWith("verify_mcp_api_key", {
      p_key_prefix: "abcdef12",
      p_presented_key: VALID_API_KEY,
    });
  });

  it("rejects malformed and revoked keys", async () => {
    const rpc = vi.fn(async () => ({
      data: [],
      error: null,
    }));

    await expect(validateMcpApiKey("alex_bad", { rpc })).resolves.toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(rpc).not.toHaveBeenCalled();

    await expect(validateMcpApiKey(VALID_API_KEY, { rpc })).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("does not authenticate internal OAuth grant key prefixes through API-key validation", async () => {
    const rpc = vi.fn();

    await expect(
      validateMcpApiKey(`alex_oauth_12345678_${"0".repeat(32)}`, { rpc }),
    ).resolves.toEqual({
      ok: false,
      reason: "malformed",
    });
    await expect(
      validateMcpApiKey(`oauth_12345678_${"0".repeat(32)}`, { rpc }),
    ).resolves.toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("validates OAuth access bearer tokens through the OAuth verifier RPC", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          client_id: "alex_client_1",
          mcp_key_id: "oauth-mcp-key-1",
          profile_id: "profile-1",
          scopes: ["memory:read"],
          workspace_id: "workspace-1",
        },
      ],
      error: null,
    }));
    const request = new Request("https://alexandria.test/api/mcp", {
      headers: {
        authorization: `Bearer alex_oat_${"A".repeat(43)}`,
      },
    });

    await expect(validateMcpBearerToken(request, { rpc })).resolves.toEqual({
      ok: true,
      session: {
        authKind: "oauth",
        clientId: "alex_client_1",
        mcpKeyId: "oauth-mcp-key-1",
        profileId: "profile-1",
        scopes: ["memory:read"],
        workspaceId: "workspace-1",
      },
    });
    expect(rpc).toHaveBeenCalledWith("verify_oauth_access_token", {
      p_token_hash: expect.any(String),
    });
  });

  it("does not send sentinel oauth_* key material through the legacy API-key RPC", async () => {
    const rpc = vi.fn();
    const request = new Request("https://alexandria.test/api/mcp", {
      headers: {
        authorization: "Bearer oauth_12345678_sentinel",
      },
    });

    await expect(validateMcpBearerToken(request, { rpc })).resolves.toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(rpc).not.toHaveBeenCalledWith("verify_mcp_api_key", expect.anything());
  });

  it("keeps service-role verification isolated to the validation module", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/mcp/api-key-validation.ts"),
      "utf8",
    );

    expect(source).toContain("../supabase/service-role");
    expect(source).toContain("createSupabaseServiceRoleClient");
  });
});
