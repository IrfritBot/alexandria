import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { validateMcpApiKey } from "./api-key-validation";

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

  it("keeps service-role verification isolated to the validation module", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/mcp/api-key-validation.ts"),
      "utf8",
    );

    expect(source).toContain("../supabase/service-role");
    expect(source).toContain("createSupabaseServiceRoleClient");
  });
});
