import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL("../migrations/20260501011000_initial_schema.sql", import.meta.url),
  "utf8",
);
const validationSql = readFileSync(
  new URL("./alex_001_quality.sql", import.meta.url),
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

function extractCreateTable(name: string) {
  const match = migrationSql.match(
    new RegExp(`create table public\\.${name}\\s*\\([\\s\\S]*?\\n\\);`, "i"),
  );

  expect(match, `table ${name} should exist`).not.toBeNull();

  return normalized(match?.[0] ?? "");
}

function extractPolicy(name: string) {
  const match = migrationSql.match(
    new RegExp(`create policy ${name}[\\s\\S]*?;`, "i"),
  );

  expect(match, `policy ${name} should exist`).not.toBeNull();

  return normalized(match?.[0] ?? "");
}

function extractPoliciesForTable(tableName: string) {
  return [...migrationSql.matchAll(/create policy [\s\S]*?;/gi)]
    .map((match) => match[0])
    .filter((policy) =>
      new RegExp(`on\\s+public\\.${tableName}\\b`, "i").test(policy),
    )
    .map(normalized);
}

function policyExists(name: string) {
  return new RegExp(`create policy ${name}\\b`, "i").test(migrationSql);
}

describe("ALEX-001 schema and RLS quality contracts", () => {
  const normalizedMigrationSql = normalized(migrationSql);

  it("keeps memories.embedding dimension-agnostic until tier dimensions are locked", () => {
    expect(migrationSql).toMatch(/\bembedding extensions\.vector,/);
    expect(migrationSql).not.toMatch(/\bembedding extensions\.vector\(\d+\)/);
    expect(migrationSql).not.toMatch(/using\s+hnsw\s*\(\s*embedding/i);
    expect(validationSql).toContain(
      "memories.embedding must be unconstrained vector",
    );
  });

  it("does not treat soft-deleted profiles as active workspace members", () => {
    for (const functionName of [
      "has_workspace_membership",
      "has_shared_workspace_with_profile",
      "is_workspace_admin",
      "is_own_workspace_memory",
    ]) {
      expect(extractFunction(functionName)).toContain("p.deleted_at is null");
    }

    for (const policyName of [
      "workspaces_select_user_member",
      "memories_select_user_member",
      "memory_revisions_select_user_member",
      "workspace_tags_select_user_member",
      "memory_tags_select_user_member",
    ]) {
      expect(extractPolicy(policyName)).toContain("has_workspace_membership");
    }
  });

  it("protects profiles with own-user RLS and no MCP exposure", () => {
    expect(migrationSql).toMatch(
      /alter table public\.profiles enable row level security;/i,
    );

    const profilePolicy = extractPolicy("profiles_select_own_auth_user");

    expect(profilePolicy).toContain("auth_user_id = auth.uid()");
    expect(profilePolicy).toContain("deleted_at is null");
    expect(profilePolicy).not.toContain("has_active_mcp_session");
    expect(profilePolicy).not.toContain("mcp_session_executor");

    const sharedProfileHelper = extractFunction(
      "has_shared_workspace_with_profile",
    );

    expect(sharedProfileHelper).toContain("security definer");
    expect(sharedProfileHelper).toContain("workspace_members peer_wm");
    expect(sharedProfileHelper).toContain("workspace_members current_wm");
    expect(sharedProfileHelper).toContain("auth.uid()");
    expect(sharedProfileHelper).toContain("p.deleted_at is null");
    expect(migrationSql).toMatch(
      /revoke all on function public\.has_shared_workspace_with_profile\(uuid\) from public;/i,
    );
    expect(migrationSql).toMatch(
      /grant execute on function public\.has_shared_workspace_with_profile\(uuid\) to authenticated;/i,
    );
    expect(migrationSql).not.toMatch(
      /grant execute on function public\.has_shared_workspace_with_profile\(uuid\) to [^;]*mcp_session_executor[^;]*;/i,
    );

    const sharedProfilePolicy = extractPolicy(
      "profiles_select_shared_workspace_user_member",
    );

    expect(sharedProfilePolicy).toContain("to authenticated");
    expect(sharedProfilePolicy).toContain("deleted_at is null");
    expect(sharedProfilePolicy).toContain(
      "has_shared_workspace_with_profile(id)",
    );
    expect(sharedProfilePolicy).not.toContain("has_active_mcp_session");
    expect(sharedProfilePolicy).not.toContain("mcp_session_executor");

    const profilePolicies = extractPoliciesForTable("profiles");

    expect(profilePolicies).toHaveLength(2);
    expect(normalizedMigrationSql).not.toMatch(
      /grant select on [^;]*public\.profiles[^;]* to mcp_session_executor;/,
    );
    expect(validationSql).toContain("profiles must have explicit RLS enabled");
    expect(validationSql).toContain(
      "profiles shared-workspace SELECT policy must target authenticated peers",
    );
    expect(validationSql).toContain(
      "profiles shared-workspace helper must use active shared workspace membership",
    );
    expect(validationSql).toContain(
      "authenticated must be able to execute profiles shared-workspace helper",
    );
    expect(validationSql).toContain(
      "mcp_session_executor must not execute profiles shared-workspace helper",
    );
    expect(validationSql).toContain(
      "profiles must not expose MCP profile policies",
    );
    expect(validationSql).toContain(
      "mcp_session_executor must not have SELECT on profiles",
    );
  });

  it("keeps governance SELECT access admin-only and out of MCP sessions", () => {
    for (const [tableName, policyName, oldMemberPolicy, oldMcpPolicy] of [
      [
        "conflicts",
        "conflicts_select_user_admin",
        "conflicts_select_user_member",
        "conflicts_select_mcp_session",
      ],
      [
        "audit_log_memory",
        "audit_log_memory_select_user_admin",
        "audit_log_memory_select_user_member",
        "audit_log_memory_select_mcp_session",
      ],
    ] as const) {
      const adminPolicy = extractPolicy(policyName);

      expect(adminPolicy).toContain("public.is_workspace_admin(workspace_id)");
      expect(adminPolicy).not.toContain("has_workspace_membership");
      expect(policyExists(oldMemberPolicy)).toBe(false);
      expect(policyExists(oldMcpPolicy)).toBe(false);

      const selectPolicies = extractPoliciesForTable(tableName).filter(
        (policy) => policy.includes(" for select "),
      );

      expect(selectPolicies).toHaveLength(1);
      expect(selectPolicies[0]).not.toContain("has_active_mcp_session");
      expect(selectPolicies[0]).not.toContain("mcp_session");
    }
  });

  it("locks set_mcp_session to the non-BYPASSRLS MCP executor path", () => {
    const sessionFunction = extractFunction("set_mcp_session");

    expect(normalizedMigrationSql).toContain(
      "create role mcp_session_executor nologin noinherit nobypassrls",
    );
    expect(normalizedMigrationSql).toContain(
      "alter role mcp_session_executor with nologin noinherit nobypassrls",
    );
    expect(sessionFunction).toContain("security definer");
    expect(sessionFunction).toContain("set search_path = public, pg_temp");
    expect(migrationSql).toMatch(
      /revoke all on function public\.set_mcp_session\(uuid,\s*uuid\) from public;/i,
    );
    expect(migrationSql).toMatch(
      /revoke all on function public\.set_mcp_session\(uuid,\s*uuid\) from service_role;/i,
    );
    expect(migrationSql).toMatch(
      /grant execute on function public\.set_mcp_session\(uuid,\s*uuid\) to mcp_session_executor;/i,
    );
    expect(migrationSql).not.toMatch(
      /grant execute on function public\.set_mcp_session\(uuid,\s*uuid\) to service_role;/i,
    );
    expect(migrationSql).not.toMatch(
      /grant execute on function public\.set_mcp_session\(uuid,\s*uuid\) to [^;]*(public|anon|authenticated|service_role)[^;]*;/i,
    );
    expect(validationSql).toContain(
      "set_mcp_session must not be executable by PUBLIC",
    );
    expect(validationSql).toContain(
      "set_mcp_session must be executable by mcp_session_executor",
    );
    expect(validationSql).toContain(
      "set_mcp_session must not be executable by service_role because service_role bypasses RLS",
    );
    expect(validationSql).toContain(
      "mcp_session_executor must be a non-superuser, non-BYPASSRLS role",
    );
  });

  it("removes PUBLIC EXECUTE fallback from RLS helper functions", () => {
    for (const helperSignature of [
      "has_workspace_membership\\(uuid\\)",
      "has_shared_workspace_with_profile\\(uuid\\)",
      "is_workspace_admin\\(uuid\\)",
      "is_own_workspace_memory\\(uuid,\\s*uuid\\)",
    ]) {
      expect(migrationSql).toMatch(
        new RegExp(
          `revoke all on function public\\.${helperSignature} from public;`,
          "i",
        ),
      );
      expect(migrationSql).toMatch(
        new RegExp(
          `grant execute on function public\\.${helperSignature} to authenticated;`,
          "i",
        ),
      );
      expect(migrationSql).not.toMatch(
        new RegExp(
          `grant execute on function public\\.${helperSignature} to [^;]*mcp_session_executor[^;]*;`,
          "i",
        ),
      );
    }

    expect(migrationSql).toMatch(
      /revoke all on function public\.has_active_mcp_session\(uuid\) from public;/i,
    );
    expect(migrationSql).toMatch(
      /grant execute on function public\.has_active_mcp_session\(uuid\) to mcp_session_executor;/i,
    );
    expect(migrationSql).not.toMatch(
      /grant execute on function public\.has_active_mcp_session\(uuid\) to [^;]*authenticated[^;]*;/i,
    );

    expect(normalizedMigrationSql).toContain(
      "revoke all on function public.is_raw_memory_insert( text, numeric, text, text, extensions.vector, uuid, timestamptz, timestamptz ) from public;",
    );
    expect(normalizedMigrationSql).toContain(
      "grant execute on function public.is_raw_memory_insert( text, numeric, text, text, extensions.vector, uuid, timestamptz, timestamptz ) to authenticated, mcp_session_executor;",
    );

    expect(validationSql).toContain(
      "RLS helper functions must not be executable by PUBLIC",
    );
    expect(validationSql).toContain(
      "authenticated missing required RLS helper EXECUTE grants",
    );
    expect(validationSql).toContain(
      "authenticated must not execute MCP-only RLS helpers",
    );
    expect(validationSql).toContain(
      "mcp_session_executor missing required RLS helper EXECUTE grants",
    );
    expect(validationSql).toContain(
      "mcp_session_executor must not execute web/user RLS helpers",
    );
    expect(validationSql).toContain(
      "RLS helper functions have forbidden direct EXECUTE grants",
    );
  });

  it("targets web/user RLS policies to authenticated instead of PUBLIC", () => {
    for (const policyName of [
      "profiles_select_own_auth_user",
      "profiles_select_shared_workspace_user_member",
      "workspace_members_select_user_workspace_member",
      "workspaces_select_user_member",
      "mcp_keys_select_user_admin",
      "memories_select_user_member",
      "memory_revisions_select_user_member",
      "conflicts_select_user_admin",
      "workspace_tags_select_user_member",
      "memory_tags_select_user_member",
      "audit_log_memory_select_user_admin",
      "audit_log_workspace_select_user_admin",
      "usage_events_select_user_admin",
      "workspace_invites_select_user_admin",
      "memories_insert_user_member",
      "memories_update_user_admin",
      "mcp_keys_insert_user_admin",
      "mcp_keys_update_user_admin",
      "workspace_invites_insert_user_admin",
      "workspace_invites_update_user_admin",
      "conflicts_update_user_admin",
      "workspaces_update_user_admin",
      "workspace_members_insert_user_admin",
      "workspace_members_update_user_admin",
      "workspace_members_delete_user_admin",
    ]) {
      expect(extractPolicy(policyName)).toContain("to authenticated");
    }

    expect(validationSql).toContain(
      "web/user RLS policies must target authenticated, not PUBLIC",
    );
  });

  it("grants only the minimal MCP data surface to the executor role", () => {
    const selectGrant = normalizedMigrationSql.match(
      /grant select on (.*?) to mcp_session_executor;/,
    )?.[1];

    expect(selectGrant).toBeDefined();

    for (const tableName of [
      "workspaces",
      "workspace_members",
      "memories",
      "memory_revisions",
      "workspace_tags",
      "memory_tags",
    ]) {
      expect(selectGrant).toContain(`public.${tableName}`);
    }

    for (const forbiddenTableName of [
      "profiles",
      "mcp_keys",
      "conflicts",
      "audit_log_memory",
      "audit_log_workspace",
      "usage_events",
      "workspace_invites",
    ]) {
      expect(selectGrant).not.toContain(`public.${forbiddenTableName}`);
    }

    expect(normalizedMigrationSql).toContain(
      "grant insert on public.memories to mcp_session_executor;",
    );
    expect(normalizedMigrationSql).not.toMatch(
      /grant (update|delete) on [^;]* to mcp_session_executor;/,
    );

    for (const policyName of [
      "workspaces_select_mcp_session",
      "workspace_members_select_mcp_session",
      "memories_select_mcp_session",
      "memory_revisions_select_mcp_session",
      "workspace_tags_select_mcp_session",
      "memory_tags_select_mcp_session",
      "memories_insert_mcp_session",
    ]) {
      expect(extractPolicy(policyName)).toContain("to mcp_session_executor");
    }

    expect(validationSql).toContain(
      "mcp_session_executor missing minimal MCP SELECT grants",
    );
    expect(validationSql).toContain(
      "mcp_session_executor has forbidden SELECT grants",
    );
    expect(validationSql).toContain(
      "MCP policies must target only mcp_session_executor, not PUBLIC",
    );
  });

  it("maintains updated_at automatically on mutable timestamped tables", () => {
    const updatedAtFunction = extractFunction("set_current_updated_at");

    expect(updatedAtFunction).toContain("new.updated_at = now()");

    for (const tableName of [
      "profiles",
      "workspaces",
      "workspace_members",
      "mcp_keys",
      "memories",
      "conflicts",
      "workspace_tags",
      "workspace_invites",
    ]) {
      expect(migrationSql).toMatch(
        new RegExp(
          `create trigger ${tableName}_set_updated_at\\s+before update on public\\.${tableName}\\s+for each row execute function public\\.set_current_updated_at\\(\\);`,
          "i",
        ),
      );
    }

    expect(validationSql).toContain(
      "updated_at maintenance triggers missing from tables",
    );
  });

  it("preserves append/revoke semantics for MCP keys", () => {
    const triggerFunction = extractFunction("prevent_mcp_key_immutable_update");

    for (const protectedFieldCheck of [
      "new.id is distinct from old.id",
      "new.workspace_id is distinct from old.workspace_id",
      "new.name is distinct from old.name",
      "new.key_prefix is distinct from old.key_prefix",
      "new.key_hash is distinct from old.key_hash",
      "new.created_by_profile_id is distinct from old.created_by_profile_id",
      "new.created_at is distinct from old.created_at",
    ]) {
      expect(triggerFunction).toContain(protectedFieldCheck);
    }

    for (const allowedOperationalFieldCheck of [
      "new.revoked_at is distinct from old.revoked_at",
      "new.revoked_by_profile_id is distinct from old.revoked_by_profile_id",
      "new.last_used_at is distinct from old.last_used_at",
      "new.updated_at is distinct from old.updated_at",
    ]) {
      expect(triggerFunction).not.toContain(allowedOperationalFieldCheck);
    }

    expect(migrationSql).toMatch(
      /create trigger mcp_keys_prevent_immutable_update\s+before update on public\.mcp_keys\s+for each row execute function public\.prevent_mcp_key_immutable_update\(\);/i,
    );
    expect(validationSql).toContain(
      "mcp_keys immutable-field trigger is missing protected field checks",
    );
    expect(validationSql).toContain(
      "mcp_keys immutable-field trigger blocks legitimate operational fields",
    );
    expect(validationSql).toContain(
      "mcp_keys immutable-field update trigger is missing",
    );
  });

  it("blocks impossible workspace invite lifecycle states", () => {
    const workspaceInvitesTable = extractCreateTable("workspace_invites");

    expect(workspaceInvitesTable).toContain(
      "constraint workspace_invites_accepted_profile_check check ( accepted_at is null or accepted_by_profile_id is not null )",
    );
    expect(workspaceInvitesTable).toContain(
      "constraint workspace_invites_accepted_at_check check ( accepted_by_profile_id is null or accepted_at is not null )",
    );
    expect(workspaceInvitesTable).toContain(
      "constraint workspace_invites_not_accepted_and_revoked_check check ( accepted_at is null or revoked_at is null )",
    );
    expect(validationSql).toContain(
      "workspace_invites lifecycle check constraints are missing",
    );
  });

  it("prevents simultaneous active workspace invites per normalized email", () => {
    const triggerFunction = extractFunction(
      "enforce_single_active_workspace_invite",
    );

    expect(triggerFunction).toContain("lower(btrim(new.email))");
    expect(triggerFunction).toContain("pg_advisory_xact_lock");
    expect(triggerFunction).toContain("new.accepted_at is not null");
    expect(triggerFunction).toContain("new.revoked_at is not null");
    expect(triggerFunction).toContain("new.expires_at <= now()");
    expect(triggerFunction).toContain("lower(btrim(existing_invite.email))");
    expect(triggerFunction).toContain("existing_invite.accepted_at is null");
    expect(triggerFunction).toContain("existing_invite.revoked_at is null");
    expect(triggerFunction).toContain("existing_invite.expires_at > now()");
    expect(triggerFunction).toContain("existing_invite.id <> new.id");

    expect(migrationSql).toMatch(
      /create trigger workspace_invites_enforce_single_active\s+before insert or update on public\.workspace_invites\s+for each row execute function public\.enforce_single_active_workspace_invite\(\);/i,
    );
    expect(normalizedMigrationSql).toContain(
      "create index workspace_invites_workspace_id_email_active_idx on public.workspace_invites (workspace_id, lower(btrim(email)), expires_at) where accepted_at is null and revoked_at is null;",
    );
    expect(validationSql).toContain(
      "workspace_invites active-invite uniqueness trigger is missing",
    );
    expect(validationSql).toContain(
      "workspace_invites active-invite uniqueness trigger is missing expiry-aware duplicate checks",
    );
    expect(validationSql).toContain(
      "workspace_invites active email lookup index must support expiry-aware invite uniqueness",
    );
  });

  it("limits user and MCP memory inserts to the raw pre-processing shape", () => {
    const rawInsertFunction = extractFunction("is_raw_memory_insert");

    for (const requiredClause of [
      "p_kind = 'unknown'",
      "p_kind_confidence is null",
      "p_status = 'processing'",
      "p_processing_tier = 'basic'",
      "p_embedding is null",
      "p_superseded_by_memory_id is null",
      "p_processed_at is null",
      "p_deleted_at is null",
    ]) {
      expect(rawInsertFunction).toContain(requiredClause);
    }

    const userInsertPolicy = extractPolicy("memories_insert_user_member");

    expect(userInsertPolicy).toContain("is_own_workspace_memory");
    expect(userInsertPolicy).toContain("is_raw_memory_insert");

    const mcpInsertPolicy = extractPolicy("memories_insert_mcp_session");

    expect(mcpInsertPolicy).toContain("to mcp_session_executor");
    expect(mcpInsertPolicy).toContain("has_active_mcp_session");
    expect(mcpInsertPolicy).toContain("author_profile_id is null");
    expect(mcpInsertPolicy).toContain("is_raw_memory_insert");
  });

  it("keeps memory_revisions as immutable snapshots of memory state", () => {
    const memoryRevisionsTable = extractCreateTable("memory_revisions");

    for (const requiredColumn of [
      "superseded_by_memory_id uuid",
      "kind_confidence numeric",
      "processed_at timestamptz",
    ]) {
      expect(memoryRevisionsTable).toContain(requiredColumn);
    }

    expect(memoryRevisionsTable).toContain(
      "constraint memory_revisions_superseded_by_memory_workspace_fk foreign key (workspace_id, superseded_by_memory_id) references public.memories(workspace_id, id)",
    );
    expect(memoryRevisionsTable).toContain(
      "constraint memory_revisions_kind_confidence_check check ( kind_confidence is null or (kind_confidence >= 0 and kind_confidence <= 1) )",
    );
    expect(memoryRevisionsTable).toContain(
      "constraint memory_revisions_not_self_superseded_check check ( superseded_by_memory_id is null or superseded_by_memory_id <> memory_id )",
    );

    expect(validationSql).toContain(
      "memory_revisions.kind_confidence is missing",
    );
    expect(validationSql).toContain("memory_revisions.processed_at is missing");
    expect(validationSql).toContain(
      "memory_revisions.superseded_by_memory_id is missing",
    );
    expect(validationSql).toContain(
      "memory_revisions superseded-memory foreign key is missing",
    );
    expect(validationSql).toContain(
      "memory_revisions kind_confidence range check is missing",
    );
    expect(validationSql).toContain(
      "memory_revisions self-supersession check is missing",
    );
  });

  it("blocks impossible conflict state/result combinations", () => {
    const conflictsTable = extractCreateTable("conflicts");

    expect(conflictsTable).toContain(
      "constraint conflicts_unresolved_empty_result_check check",
    );
    expect(conflictsTable).toContain("status <> 'unresolved'");
    expect(conflictsTable).toContain("winner_memory_id is null");
    expect(conflictsTable).toContain("merged_memory_id is null");
    expect(conflictsTable).toContain("resolution_strategy is null");
    expect(conflictsTable).toContain("resolution is null");
    expect(conflictsTable).toContain("resolved_by_profile_id is null");
    expect(conflictsTable).toContain("resolved_at is null");

    expect(conflictsTable).toContain(
      "constraint conflicts_winner_status_check check",
    );
    expect(conflictsTable).toContain(
      "status in ('auto_resolved', 'admin_resolved')",
    );
    expect(conflictsTable).toContain("winner_memory_id is not null");
    expect(conflictsTable).toContain(
      "status not in ('auto_resolved', 'admin_resolved')",
    );

    expect(conflictsTable).toContain(
      "constraint conflicts_resolved_at_status_check check ( status = 'unresolved' or resolved_at is not null )",
    );
    expect(conflictsTable).toContain(
      "constraint conflicts_merged_memory_check check",
    );

    expect(validationSql).toContain(
      "conflicts unresolved-empty-result check constraint is missing",
    );
    expect(validationSql).toContain(
      "conflicts winner-status check constraint is missing",
    );
    expect(validationSql).toContain(
      "conflicts resolved-at status check constraint is missing",
    );
  });

  it("protects system-managed memory fields while allowing admin governance corrections", () => {
    expect(extractPolicy("memories_update_user_admin")).toContain(
      "is_workspace_admin",
    );
    expect(migrationSql).toMatch(
      /create trigger memories_enforce_user_write_contract\s+before insert or update or delete on public\.memories/i,
    );

    const triggerFunction = extractFunction(
      "enforce_memories_user_write_contract",
    );

    expect(triggerFunction).toContain("auth.role() = 'service_role'");
    expect(triggerFunction).toContain("v_actor_kind = 'mcp_key'");
    expect(triggerFunction).toContain("has_active_mcp_session");
    expect(triggerFunction).toContain("tg_op in ('update', 'delete')");
    expect(triggerFunction).toContain("v_is_authenticated_admin");
    expect(triggerFunction).toContain("auth.role() = 'authenticated'");
    expect(triggerFunction).toContain("is_workspace_admin(old.workspace_id)");

    for (const adminGovernedFieldCheck of [
      "not v_is_authenticated_admin and new.kind is distinct from old.kind",
      "not v_is_authenticated_admin and new.kind_confidence is distinct from old.kind_confidence",
      "not v_is_authenticated_admin and new.deleted_at is distinct from old.deleted_at",
    ]) {
      expect(triggerFunction).toContain(adminGovernedFieldCheck);
    }

    for (const protectedFieldCheck of [
      "new.id is distinct from old.id",
      "new.author_profile_id is distinct from old.author_profile_id",
      "new.superseded_by_memory_id is distinct from old.superseded_by_memory_id",
      "new.kind is distinct from old.kind",
      "new.kind_confidence is distinct from old.kind_confidence",
      "new.status is distinct from old.status",
      "new.processing_tier is distinct from old.processing_tier",
      "new.embedding::text is distinct from old.embedding::text",
      "new.processed_at is distinct from old.processed_at",
      "new.created_at is distinct from old.created_at",
      "new.deleted_at is distinct from old.deleted_at",
    ]) {
      expect(triggerFunction).toContain(protectedFieldCheck);
    }
  });
});
