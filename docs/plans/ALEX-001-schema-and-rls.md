# ALEX-001: Initial schema + RLS skeleton

**Goal:** Add the first durable Supabase schema for Alexandria so the app has the 13 locked tables, core indexes, and tenant-isolation policy scaffolding from the spec.

**Architecture:** Use standard Supabase migrations under `supabase/migrations/`. Keep this slice at the database layer only: tables, indexes, helper function, and baseline RLS policies. No API routes, no auth flows, no business logic.

**Constraints:**
- Do not build workspace creation flows, invite flows, or MCP request handling yet.
- Do not invent extra tables beyond the 13 in the locked spec.
- Do not overbuild search or worker logic; only add schema elements needed now.
- Keep SQL readable and commented where the policy logic is non-obvious.

---

### Task 1: Bootstrap Supabase schema layout

**Files:**
- Create: `supabase/migrations/20260501011000_initial_schema.sql`
- Create: `supabase/README.md`

**Steps:**
- [ ] Create the first migration file in standard Supabase layout.
- [ ] Add a short `supabase/README.md` explaining how migrations are organized in this repo.
- [ ] Enable required extensions only if needed by the locked spec and available in Supabase (`pgcrypto`, `vector` if used in schema now).

**Expected behavior:** Repo has a clear place for database evolution and one initial migration file ready to apply.

### Task 2: Create the 13 locked tables

**Files:**
- Modify: `supabase/migrations/20260501011000_initial_schema.sql`

**Steps:**
- [ ] Add tables from the locked schema: `workspaces`, `profiles`, `workspace_members`, `mcp_keys`, `memories`, `memory_revisions`, `conflicts`, `workspace_tags`, `memory_tags`, `audit_log_memory`, `audit_log_workspace`, `usage_events`, `workspace_invites`.
- [ ] Include `workspace_id` on every tenant-owned row called out in project context.
- [ ] Include `deleted_at` on user-content tables where required by the spec.
- [ ] Keep FK names aligned with the referenced table naming rule.
- [ ] Add obvious constraints/checks for roles, statuses, and uniqueness where the spec is explicit.

**Expected behavior:** The migration expresses the full v1 table skeleton without API/business-layer assumptions.

### Task 3: Add tenant-safety indexes and helper function

**Files:**
- Modify: `supabase/migrations/20260501011000_initial_schema.sql`

**Steps:**
- [ ] Add core indexes that lead with `workspace_id` for workspace-scoped tables.
- [ ] Add the `set_mcp_session(p_workspace_id UUID, p_mcp_key_id UUID)` helper from the spec using transaction-local `set_config`.
- [ ] Add a dedicated non-`BYPASSRLS` MCP executor role for tenant-data queries; `service_role` may verify keys outside RLS but must not execute `set_mcp_session` or run MCP RLS-protected data queries as the current role.
- [ ] Add any minimal supporting indexes for invites, memberships, and MCP key lookup that are explicitly needed by the spec.

**Expected behavior:** The migration includes the load-bearing performance/safety scaffolding for future API work.

### Task 4: Add baseline RLS skeleton

**Files:**
- Modify: `supabase/migrations/20260501011000_initial_schema.sql`

**Steps:**
- [ ] Enable RLS on workspace-scoped tables.
- [ ] Add baseline SELECT policies for the user and MCP paths where allowed by the spec, with governance/admin-owned tables limited to workspace admins.
- [ ] Add conservative INSERT/UPDATE/DELETE policy scaffolding only where the spec is already explicit; do not guess beyond the spec.
- [ ] Keep comments near the policy templates so later tasks can extend them safely.

**Expected behavior:** The schema has an explicit tenant boundary skeleton matching the Alexandria spec.

### Task 5: Add minimal verification artifacts

**Files:**
- Create: `supabase/schema-notes.md`
- Optionally create: lightweight SQL sanity file if useful, but do not add a fake harness

**Steps:**
- [ ] Document any assumptions made where the spec leaves implementation detail open.
- [ ] Verify migration SQL is syntactically coherent via the smallest practical repo check.
- [ ] Run repo verification (`npm run lint && npm run typecheck && npm run test && npm run build`) and include any DB-specific validation you can do locally.

**Expected behavior:** There is a clear record of assumptions and the repo still passes its existing checks.

---

## Done criteria
- Initial migration exists and covers the 13 locked tables.
- `workspace_id` propagation and baseline indexes match the spec intent.
- `set_mcp_session(...)` exists and is executable by the non-`BYPASSRLS` MCP executor role, not directly by `service_role`.
- Baseline RLS skeleton exists for user and MCP paths, excluding MCP SELECT on governance/admin-owned tables.
- Repo checks still pass.
- No out-of-scope API/auth/product work added.
