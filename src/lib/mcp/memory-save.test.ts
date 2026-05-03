import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  MEMORY_PROCESS_REQUESTED_EVENT,
  saveMcpMemory,
  validateMemorySavePayload,
} from "./memory-save";

vi.mock("server-only", () => ({}));

function migrationSql() {
  return readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260503150000_mcp_memory_save.sql",
    ),
    "utf8",
  );
}

describe("validateMemorySavePayload", () => {
  it("normalizes cheap structured tags", () => {
    expect(
      validateMemorySavePayload({
        content: "  Remember the Friday deploy freeze.  ",
        tags: [
          " Product Updates ",
          "#Policy",
          "product_updates",
          "client/Ashley Stambouli/",
          " ",
        ],
      }),
    ).toEqual({
      ok: true,
      content: "Remember the Friday deploy freeze.",
      tags: ["product-updates", "policy", "client/ashley-stambouli"],
    });
  });

  it("rejects invalid content and tags before persistence", () => {
    expect(validateMemorySavePayload({ content: "" })).toEqual({
      ok: false,
      field: "content",
    });
    expect(
      validateMemorySavePayload({
        content: "x".repeat(8193),
      }),
    ).toEqual({
      ok: false,
      field: "content",
    });
    expect(
      validateMemorySavePayload({
        content: "Remember this.",
        tags: ["policy", 1],
      }),
    ).toEqual({
      ok: false,
      field: "tags",
    });
  });
});

describe("saveMcpMemory", () => {
  it("calls the memory save RPC and enqueues the processing event", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          memory_id: "memory-1",
          status: "processing",
        },
      ],
      error: null,
    }));
    const eventClient = {
      send: vi.fn(async () => ({ ids: ["event-1"] })),
    };

    await expect(
      saveMcpMemory(
        {
          content: "  Remember the deploy freeze.  ",
          tags: ["Release Notes", "#Policy"],
        },
        {
          mcpKeyId: "mcp-key-1",
          workspaceId: "workspace-1",
        },
        {
          eventClient,
          rpcClient: { rpc },
        },
      ),
    ).resolves.toEqual({
      ok: true,
      memoryId: "memory-1",
      message: "Memory accepted for processing.",
      status: "processing",
    });
    expect(rpc).toHaveBeenCalledWith("save_mcp_memory", {
      p_content: "Remember the deploy freeze.",
      p_mcp_key_id: "mcp-key-1",
      p_tags: ["release-notes", "policy"],
      p_workspace_id: "workspace-1",
    });
    expect(eventClient.send).toHaveBeenCalledWith({
      data: {
        mcp_key_id: "mcp-key-1",
        memory_id: "memory-1",
        tags: ["release-notes", "policy"],
        workspace_id: "workspace-1",
      },
      name: MEMORY_PROCESS_REQUESTED_EVENT,
    });
  });

  it("documents the database write loop in the migration", () => {
    const sql = migrationSql().toLowerCase();

    expect(sql).toContain("create or replace function public.save_mcp_memory");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("perform public.set_mcp_session");
    expect(sql).toContain("insert into public.memories");
    expect(sql).toContain("insert into public.memory_revisions");
    expect(sql).toContain("insert into public.workspace_tags");
    expect(sql).toContain("insert into public.memory_tags");
    expect(sql).toContain("insert into public.audit_log_memory");
    expect(sql).toContain("insert into public.usage_events");
    expect(sql).toContain("'processing'");
    expect(sql).toContain("'memory_save_requested'");
    expect(sql).toContain(
      "grant execute on function public.save_mcp_memory(uuid, uuid, text, jsonb) to mcp_session_executor",
    );
    expect(sql).toContain(
      "revoke all on function public.save_mcp_memory(uuid, uuid, text, jsonb) from service_role",
    );
    expect(sql).not.toContain(
      "grant execute on function public.save_mcp_memory(uuid, uuid, text, jsonb) to service_role",
    );
  });
});
