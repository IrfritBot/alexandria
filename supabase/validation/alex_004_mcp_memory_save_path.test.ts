import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL("../migrations/20260503150000_mcp_memory_save.sql", import.meta.url),
  "utf8",
).toLowerCase();
const validationSql = readFileSync(
  new URL("./alex_004_mcp_memory_save_path.sql", import.meta.url),
  "utf8",
).toLowerCase();

describe("ALEX-004 MCP memory_save DB validation coverage", () => {
  it("keeps tenant writes on the executor/RLS path", () => {
    expect(migrationSql).toContain("security invoker");
    expect(migrationSql).toContain("perform public.set_mcp_session");
    expect(migrationSql).toContain(
      "grant execute on function public.save_mcp_memory(uuid, uuid, text, jsonb) to mcp_session_executor",
    );
    expect(migrationSql).toContain(
      "revoke all on function public.save_mcp_memory(uuid, uuid, text, jsonb) from service_role",
    );
    expect(migrationSql).not.toContain(
      "grant execute on function public.save_mcp_memory(uuid, uuid, text, jsonb) to service_role",
    );
  });

  it("persists normalized tags through workspace_tags and memory_tags", () => {
    expect(migrationSql).toContain("insert into public.workspace_tags");
    expect(migrationSql).toContain("on conflict (workspace_id, name) do nothing");
    expect(migrationSql).toContain("insert into public.memory_tags");
    expect(migrationSql).toContain("workspace_tags_insert_mcp_session");
    expect(migrationSql).toContain("memory_tags_insert_mcp_session");
  });

  it("provides runnable DB integration checks for the review blockers", () => {
    for (const expectedSnippet of [
      "alex 004 workspace one",
      "alex 004 workspace two",
      "verify_mcp_api_key",
      "revoked mcp key must not verify",
      "invalid mcp key secret must not verify",
      "set local role mcp_session_executor",
      "cross-workspace mcp key save must be rejected",
      "direct cross-workspace insert must be denied by rls",
      "mcp session settings must clear after transaction commit",
      "memory_save did not persist normalized memory_tags rows",
    ]) {
      expect(validationSql).toContain(expectedSnippet);
    }
  });
});
