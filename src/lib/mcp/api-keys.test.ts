import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  generateMcpApiKey,
  issueMcpKey,
  listMcpKeys,
  parseMcpApiKey,
  revokeMcpKey,
} from "./api-keys";

vi.mock("server-only", () => ({}));

function migrationSql() {
  return readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260503093000_mcp_key_lifecycle.sql",
    ),
    "utf8",
  );
}

describe("MCP API keys", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("generates and parses the required key format", () => {
    const apiKey = generateMcpApiKey();
    const parsedKey = parseMcpApiKey(apiKey);

    expect(apiKey).toMatch(/^alex_[a-f0-9]{8}_[a-f0-9]{32}$/);
    expect(parsedKey?.keyPrefix).toHaveLength(8);
  });

  it("issues a one-time raw key while storing only prefix and hash inputs", async () => {
    const rpc = vi.fn(async (_functionName, args) => ({
      data: [
        {
          created_at: "2026-05-03T09:30:00.000Z",
          id: "mcp-key-1",
          key_prefix: args.p_key_prefix,
          name: args.p_name,
          workspace_id: args.p_workspace_id,
        },
      ],
      error: null,
    }));

    const result = await issueMcpKey(
      { name: "Local agent", workspaceId: "workspace-1" },
      { rpc },
    );

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error("expected key issue to succeed");
    }

    expect(result.key.apiKey).toMatch(/^alex_[a-f0-9]{8}_[a-f0-9]{32}$/);
    expect(result.key.keyPrefix).toBe(parseMcpApiKey(result.key.apiKey)?.keyPrefix);
    expect(rpc).toHaveBeenCalledWith("issue_mcp_key", {
      p_key_prefix: result.key.keyPrefix,
      p_name: "Local agent",
      p_presented_key: result.key.apiKey,
      p_workspace_id: "workspace-1",
    });
    expect(JSON.stringify(result)).not.toContain("key_hash");
  });

  it("lists safe key metadata without selecting hashes", async () => {
    const order = vi.fn(async () => ({
      data: [
        {
          created_at: "2026-05-03T09:30:00.000Z",
          created_by_profile_id: "profile-1",
          id: "mcp-key-1",
          key_hash: "must-not-leak",
          key_prefix: "abcdef12",
          last_used_at: null,
          name: "Local agent",
          revoked_at: null,
          revoked_by_profile_id: null,
          workspace_id: "workspace-1",
        },
      ],
      error: null,
    }));
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn((columns: string) => {
      void columns;
      return { eq };
    });
    const from = vi.fn(() => ({ select }));

    const result = await listMcpKeys(
      { workspaceId: "workspace-1" },
      { from },
    );

    expect(result.ok).toBe(true);
    expect(select).toHaveBeenCalledWith(
      "id, workspace_id, name, key_prefix, created_by_profile_id, revoked_by_profile_id, created_at, last_used_at, revoked_at",
    );
    expect(select.mock.calls[0]?.[0]).not.toContain("key_hash");
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
  });

  it("revokes keys through the admin RPC", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          id: "mcp-key-1",
          key_prefix: "abcdef12",
          name: "Local agent",
          revoked_at: "2026-05-03T09:45:00.000Z",
          workspace_id: "workspace-1",
        },
      ],
      error: null,
    }));

    await expect(
      revokeMcpKey(
        { mcpKeyId: "mcp-key-1", workspaceId: "workspace-1" },
        { rpc },
      ),
    ).resolves.toEqual({
      ok: true,
      key: {
        id: "mcp-key-1",
        keyPrefix: "abcdef12",
        name: "Local agent",
        revokedAt: "2026-05-03T09:45:00.000Z",
        workspaceId: "workspace-1",
      },
    });
    expect(rpc).toHaveBeenCalledWith("revoke_mcp_key", {
      p_mcp_key_id: "mcp-key-1",
      p_workspace_id: "workspace-1",
    });
  });

  it("defines bcrypt-backed lifecycle RPCs without granting MCP verification to public paths", () => {
    const sql = migrationSql();
    const mcpKeysInsert = sql.match(
      /insert into public\.mcp_keys(?:\s+as\s+\w+)?\s*\(([\s\S]*?)\)\s*values\s*\(([\s\S]*?)\)\s*returning/i,
    );

    expect(mcpKeysInsert?.[1]).toContain("key_prefix");
    expect(mcpKeysInsert?.[1]).toContain("key_hash");
    expect(mcpKeysInsert?.[1]).not.toContain("p_presented_key");
    expect(mcpKeysInsert?.[2]).toContain(
      "extensions.crypt(p_presented_key, extensions.gen_salt('bf', 12))",
    );
    expect(sql).toContain("mk.revoked_at is null");
    expect(sql).toContain(
      "mk.key_hash = extensions.crypt(p_presented_key, mk.key_hash)",
    );
    expect(sql).toContain(
      "grant execute on function public.issue_mcp_key(uuid, text, text, text) to authenticated",
    );
    expect(sql).toContain(
      "grant execute on function public.revoke_mcp_key(uuid, uuid) to authenticated",
    );
    expect(sql).toContain(
      "grant execute on function public.verify_mcp_api_key(text, text) to service_role",
    );
    expect(sql).toContain(
      "revoke all on function public.verify_mcp_api_key(text, text) from authenticated",
    );
  });

  it("keeps UI-facing key-management helpers service-role-free", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/mcp/api-keys.ts"),
      "utf8",
    );

    expect(source).not.toContain("../supabase/service-role");
    expect(source).not.toContain("createSupabaseServiceRoleClient");
  });
});
