import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../migrations/20260507123000_oauth_remote_mcp_connector.sql",
    import.meta.url,
  ),
  "utf8",
);

function normalized(sql: string) {
  return sql.replace(/\s+/g, " ").toLowerCase();
}

function extractFunction(name: string) {
  const match = migrationSql.match(
    new RegExp(
      `create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`,
      "i",
    ),
  );

  expect(match, `function ${name} should exist`).not.toBeNull();

  return normalized(match?.[0] ?? "");
}

describe("ALEX-005 OAuth connector schema contracts", () => {
  const sql = normalized(migrationSql);

  it("creates private OAuth client, code, and token tables with unique hashes", () => {
    for (const tableName of [
      "oauth_clients",
      "oauth_authorization_codes",
      "oauth_access_tokens",
    ]) {
      expect(sql).toContain(`create table public.${tableName}`);
      expect(sql).toContain(
        `alter table public.${tableName} enable row level security`,
      );
      expect(sql).toContain(`revoke all on public.${tableName} from anon`);
      expect(sql).toContain(
        `revoke all on public.${tableName} from authenticated`,
      );
      expect(sql).toContain(
        `revoke all on public.${tableName} from mcp_session_executor`,
      );
      expect(sql).toContain(
        `grant select, insert, update, delete on public.${tableName} to service_role`,
      );
    }

    expect(sql).toContain("code_hash text not null unique");
    expect(sql).toContain("token_hash text not null unique");
    expect(sql).toContain("refresh_token_hash text unique");
    expect(sql).toContain(
      "oauth_access_tokens_workspace_profile_created_at_idx",
    );
    expect(sql).toContain("oauth_access_tokens_client_id_created_at_idx");
  });

  it("consumes authorization codes atomically without select-then-update replay windows", () => {
    const consume = extractFunction("consume_oauth_authorization_code");

    expect(consume).toContain("update public.oauth_authorization_codes");
    expect(consume).toContain("consumed_at is null");
    expect(consume).toContain("expires_at > now()");
    expect(consume).toContain("returning");
    expect(sql).toContain(
      "grant execute on function public.consume_oauth_authorization_code(text) to service_role",
    );
    expect(sql).not.toContain(
      "grant execute on function public.consume_oauth_authorization_code(text) to authenticated",
    );
  });

  it("rotates refresh tokens atomically and re-checks active membership", () => {
    const rotate = extractFunction("rotate_oauth_refresh_token");

    expect(rotate).toContain("update public.oauth_access_tokens token");
    expect(rotate).toContain("token.refresh_token_hash = p_refresh_token_hash");
    expect(rotate).toContain("token.revoked_at is null");
    expect(rotate).toContain("token.refresh_expires_at > now()");
    expect(rotate).toContain("profile.deleted_at is null");
    expect(rotate).toContain("join public.workspace_members member");
    expect(rotate).toContain("insert into public.oauth_access_tokens");
    expect(sql).toContain("grant execute on function public.rotate_oauth_refresh_token");
  });

  it("verifies OAuth access tokens with membership checks and best-effort revocation", () => {
    const verify = extractFunction("verify_oauth_access_token");

    expect(verify).toContain("token.token_hash = p_token_hash");
    expect(verify).toContain("token.expires_at > now()");
    expect(verify).toContain("profile.deleted_at is null");
    expect(verify).toContain("member.workspace_id = token.workspace_id");
    expect(verify).toContain("mcp_key.revoked_at is null");
    expect(verify).toContain("set revoked_at = now()");
    expect(sql).toContain(
      "grant execute on function public.verify_oauth_access_token(text) to service_role",
    );
  });

  it("keeps existing MCP key schema untouched while allowing internal OAuth grant rows", () => {
    expect(sql).not.toContain("alter table public.mcp_keys add");
    expect(sql).not.toContain("alter table public.mcp_keys drop");
    expect(sql).not.toContain("verify_mcp_api_key");
  });
});
