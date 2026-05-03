import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  McpSessionBindingError,
  withMcpSessionTransaction,
} from "./session";

vi.mock("server-only", () => ({}));

function initialMigrationSql() {
  return readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260501011000_initial_schema.sql",
    ),
    "utf8",
  );
}

describe("withMcpSessionTransaction", () => {
  it("binds the MCP session inside the transaction before running work", async () => {
    const calls: string[] = [];
    const transactionClient = {
      rpc: vi.fn(async () => {
        calls.push("bind");
        return { error: null };
      }),
    };
    const runner = {
      transaction: vi.fn(async (work) => {
        calls.push("transaction:start");
        const result = await work(transactionClient);
        calls.push("transaction:end");
        return result;
      }),
    };

    const result = await withMcpSessionTransaction(
      runner,
      { mcpKeyId: "mcp-key-1", workspaceId: "workspace-1" },
      async (client) => {
        calls.push("work");
        expect(client).toBe(transactionClient);
        return "done";
      },
    );

    expect(result).toBe("done");
    expect(calls).toEqual([
      "transaction:start",
      "bind",
      "work",
      "transaction:end",
    ]);
    expect(transactionClient.rpc).toHaveBeenCalledWith("set_mcp_session", {
      p_mcp_key_id: "mcp-key-1",
      p_workspace_id: "workspace-1",
    });
  });

  it("does not run MCP work when session binding fails", async () => {
    const transactionClient = {
      rpc: vi.fn(async () => ({
        error: {
          message: "permission denied",
        },
      })),
    };
    const runner = {
      transaction: vi.fn(async (work) => work(transactionClient)),
    };
    const work = vi.fn();

    await expect(
      withMcpSessionTransaction(
        runner,
        { mcpKeyId: "mcp-key-1", workspaceId: "workspace-1" },
        work,
      ),
    ).rejects.toThrow(McpSessionBindingError);
    expect(work).not.toHaveBeenCalled();
  });

  it("keeps database MCP session variables transaction-local", () => {
    const sql = initialMigrationSql();

    expect(sql).toContain(
      "set_config('app.current_workspace_id', p_workspace_id::text, true)",
    );
    expect(sql).toContain(
      "set_config('app.current_mcp_key_id', p_mcp_key_id::text, true)",
    );
    expect(sql).toContain("set_config('app.actor_kind', 'mcp_key', true)");
  });
});
