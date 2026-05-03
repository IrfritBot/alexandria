import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  getMcpMemory,
  recallRecentMcpMemories,
  searchMcpMemories,
  validateMemoryGetPayload,
  validateMemoryRecallRecentPayload,
  validateMemorySearchPayload,
} from "./memory-read";

vi.mock("server-only", () => ({}));

const session = {
  mcpKeyId: "mcp-key-1",
  workspaceId: "workspace-1",
};
const memoryId = "11111111-1111-4111-8111-111111111111";

function migrationSql() {
  return readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260503170000_mcp_memory_read_tools.sql",
    ),
    "utf8",
  );
}

describe("MCP memory read payload validation", () => {
  it("normalizes search input, caps limit, and normalizes tag filters", () => {
    expect(
      validateMemorySearchPayload({
        kind: "fact",
        limit: 999,
        query: "  Ashley Shopify  ",
        tags: [" Client/Ashley Stambouli ", "#client/ashley-stambouli"],
      }),
    ).toEqual({
      kind: "fact",
      limit: 50,
      ok: true,
      query: "Ashley Shopify",
      tags: ["client/ashley-stambouli"],
    });
  });

  it("rejects invalid search, recall, and get input before persistence", () => {
    expect(validateMemorySearchPayload({ query: "" })).toEqual({
      field: "query",
      ok: false,
    });
    expect(validateMemorySearchPayload({ query: "x", kind: "unknown" })).toEqual({
      field: "kind",
      ok: false,
    });
    expect(validateMemoryRecallRecentPayload({ limit: 0 })).toEqual({
      field: "limit",
      ok: false,
    });
    expect(validateMemoryRecallRecentPayload({ since: "not-a-date" })).toEqual({
      field: "since",
      ok: false,
    });
    expect(validateMemoryGetPayload({ memory_id: "not-a-uuid" })).toEqual({
      field: "memory_id",
      ok: false,
    });
  });
});

describe("MCP memory read RPCs", () => {
  it("calls search_mcp_memories with the validated session and maps provenance", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          author_label: "MCP key",
          content: "Ashley Stambouli uses Shopify.",
          created_at: "2026-05-03T12:00:00.000Z",
          kind: "fact",
          memory_id: memoryId,
          relevance_score: 0.87654,
          source: "mcp",
          source_client: "Claude Desktop",
          tags: ["client/ashley-stambouli"],
          total_count: 3,
        },
      ],
      error: null,
    }));

    await expect(
      searchMcpMemories(
        {
          limit: 3,
          query: "Ashley",
        },
        session,
        { rpcClient: { rpc } },
      ),
    ).resolves.toEqual({
      memories: [
        {
          author_label: "MCP key",
          content: "Ashley Stambouli uses Shopify.",
          created_at: "2026-05-03T12:00:00.000Z",
          kind: "fact",
          memory_id: memoryId,
          relevance_score: 0.8765,
          source: "mcp",
          source_client: "Claude Desktop",
          tags: ["client/ashley-stambouli"],
        },
      ],
      ok: true,
      total: 3,
    });
    expect(rpc).toHaveBeenCalledWith("search_mcp_memories", {
      p_kind: null,
      p_limit: 3,
      p_mcp_key_id: "mcp-key-1",
      p_query: "Ashley",
      p_tags: [],
      p_workspace_id: "workspace-1",
    });
  });

  it("calls recall_recent_mcp_memories and omits relevance scores", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          author_label: "Workspace member",
          content: "The Friday deploy freeze is active.",
          created_at: "2026-05-03T12:00:00.000Z",
          kind: "policy",
          memory_id: memoryId,
          source: "web_ui",
          source_client: null,
          tags: ["policy"],
        },
      ],
      error: null,
    }));

    await expect(
      recallRecentMcpMemories(
        {
          limit: 1,
        },
        session,
        { rpcClient: { rpc } },
      ),
    ).resolves.toEqual({
      memories: [
        {
          author_label: "Workspace member",
          content: "The Friday deploy freeze is active.",
          created_at: "2026-05-03T12:00:00.000Z",
          kind: "policy",
          memory_id: memoryId,
          source: "web_ui",
          source_client: null,
          tags: ["policy"],
        },
      ],
      ok: true,
    });
    expect(rpc).toHaveBeenCalledWith("recall_recent_mcp_memories", {
      p_author_profile_id: null,
      p_limit: 1,
      p_mcp_key_id: "mcp-key-1",
      p_since: null,
      p_workspace_id: "workspace-1",
    });
  });

  it("returns not_found when get_mcp_memory has no same-workspace row", async () => {
    const rpc = vi.fn(async () => ({
      data: [],
      error: null,
    }));

    await expect(
      getMcpMemory(
        {
          memory_id: memoryId,
        },
        session,
        { rpcClient: { rpc } },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(rpc).toHaveBeenCalledWith("get_mcp_memory", {
      p_mcp_key_id: "mcp-key-1",
      p_memory_id: memoryId,
      p_workspace_id: "workspace-1",
    });
  });

  it("documents the MCP read RPC isolation contract in the migration", () => {
    const sql = migrationSql().toLowerCase();

    for (const functionName of [
      "public.search_mcp_memories",
      "public.recall_recent_mcp_memories",
      "public.get_mcp_memory",
    ]) {
      expect(sql).toContain(`create or replace function ${functionName}`);
    }

    expect(sql).toContain("security invoker");
    expect(sql).toContain("perform public.set_mcp_session");
    expect(sql).toContain("public.has_active_mcp_session(p_workspace_id)");
    expect(sql).toContain("m.workspace_id = p_workspace_id");
    expect(sql).toContain("m.status = 'active'");
    expect(sql).toContain("m.deleted_at is null");
    expect(sql).toContain("m.superseded_by_memory_id is null");
    expect(sql).toContain("source_client");
    expect(sql).toContain("author_label");
    expect(sql).toContain(
      "grant execute on function public.search_mcp_memories(uuid, uuid, text, integer, text, jsonb) to mcp_session_executor",
    );
    expect(sql).toContain(
      "grant execute on function public.recall_recent_mcp_memories(uuid, uuid, integer, timestamptz, uuid) to mcp_session_executor",
    );
    expect(sql).toContain(
      "grant execute on function public.get_mcp_memory(uuid, uuid, uuid) to mcp_session_executor",
    );
    expect(sql).not.toContain("grant execute on function public.get_mcp_memory(uuid, uuid, uuid) to service_role");
    expect(sql).not.toContain("delete from public.memories");
  });
});
