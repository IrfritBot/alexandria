# ALEX-002: Web auth + profile sync + workspace bootstrap

**Goal:** Add the first real human-path Alexandria flow: Supabase magic-link auth, server-side session handling, atomic `profiles` sync on first sign-in, and atomic workspace creation with the creator as default admin.

**Architecture:** User path only. Use Supabase Auth (magic-link) for identity, the `@supabase/ssr` cookie-based clients for server/browser, and **Postgres SECURITY DEFINER RPCs** for any write that the ALEX-001 RLS skeleton blocks (`profiles` self-write, `workspaces` insert, first-admin `workspace_members` insert). No code path touches the schema with anon/service-role naively.

**Constraints:**
- Do not implement MCP key issue/revoke or MCP request handling in this slice.
- **Do not implement workspace invite issue/accept** in this slice — that moves to ALEX-003.
- Do not build memory save/search flows, conflict review, worker logic, or admin dashboards.
- Do not bypass ALEX-001 RLS with ad-hoc `service_role` mutations from route handlers; tenancy bootstraps go through dedicated RPCs.
- Keep UI minimal: enough to sign in and create the first workspace.

**Out-of-slice (do not touch):**
- Invites: issue, accept, email delivery, `workspace_invites` writes.
- MCP path: keys, `set_mcp_session`, MCP routes.
- Memory product loop, search, worker.
- Member management UI beyond viewing the creator's own admin row.

---

### Task 1: Auth dependencies + SSR/cookie client foundation + client rename

**Files:**
- Modify: `package.json` (add `@supabase/ssr`)
- Modify: `package-lock.json` (committed lockfile change)
- Modify: `.env.example`
- Modify: `README.md`
- Rename: `src/lib/supabase/client.ts` → `src/lib/supabase/anon-server.ts`
- Rename: `src/lib/supabase/client.test.ts` → `src/lib/supabase/anon-server.test.ts`
- Update all imports of the renamed module across `src/**`
- Create: `src/lib/supabase/browser.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/middleware.ts`
- Test: `src/lib/supabase/server.test.ts`
- Test: `src/lib/supabase/browser.test.ts`

**Steps:**
- [x] Add `@supabase/ssr` to `dependencies` and lock the version.
- [x] Rename the existing misleadingly-named `client.ts` (it is a non-auth-bearing server anon client, not a browser client) to `anon-server.ts` and rename its test in lockstep. Update every importer. Do not leave a re-export shim.
- [x] Create `browser.ts` exporting `createSupabaseBrowserClient()` via `@supabase/ssr`'s `createBrowserClient` for client components.
- [x] Create `server.ts` exporting `createSupabaseServerClient()` via `@supabase/ssr`'s `createServerClient`, wired to Next 15 cookies API for read/write inside route handlers, server actions, and server components. Mark with `import "server-only"`.
- [x] Create `src/middleware.ts` using `@supabase/ssr`'s middleware helper to refresh sessions on each request and propagate Set-Cookie. Scope the matcher to skip static/_next/image asset paths.
- [x] Document the new env contract additions (if any) in `.env.example` and update `README.md` with the auth wiring and the `client.ts` → `anon-server.ts` rename.
- [x] Add tests that verify each helper throws on misconfigured env and constructs successfully when env is present. Browser/server cookie behavior is covered by existing `@supabase/ssr` semantics; do not re-test the library.

**Expected behavior:** The repo has three clearly-named Supabase clients (browser, server-with-cookies, anon-server) plus working session-refresh middleware, and no consumer is left importing the old name.

---

### Task 2: Login page + auth callback with safe redirect handling

**Files:**
- Create: `src/app/login/page.tsx`
- Create: `src/app/auth/callback/route.ts`
- Create: `src/lib/auth/safe-next.ts`
- Test: `src/app/auth/callback/route.test.ts`
- Test: `src/lib/auth/safe-next.test.ts`

**Steps:**
- [x] Login page: client component with email input that calls `signInWithOtp({ email, emailRedirectTo: <origin>/auth/callback?next=<encoded next> })`. Accept an optional `next` query param to forward through the magic-link round-trip. Render success state ("check your email") deterministically.
- [x] Implement `getSafeNext(rawNext: string | null): string` in `src/lib/auth/safe-next.ts`:
  - Default to `/`.
  - Reject any value that does not start with `/` or contains `//`, `\\`, `:`, scheme, or whitespace.
  - Reject paths starting with `/api/` or `/auth/` to prevent loops/escalation.
  - The function is the **only** way the callback decides where to redirect.
- [x] Auth callback route: `GET /auth/callback`:
  - Read `code` and `next` from the URL.
  - If `code` is missing → redirect to `/login?error=missing_code`.
  - Call `exchangeCodeForSession(code)` via the server cookie client. On error → `/login?error=exchange_failed` (do not leak the raw error).
  - On success: call the profile-sync RPC from Task 3 with `auth.uid()`. If the RPC fails, log and redirect to `/login?error=profile_sync_failed` (no orphaned auth-but-no-profile state should be silently shipped to the app).
  - Compute `target = getSafeNext(next)` and 303-redirect there.
- [x] Tests for the callback cover: missing code, exchange failure, profile-sync failure, success with valid `next`, success with malicious `next` (rejected → fallback to `/`).
- [x] Tests for `getSafeNext` cover: valid relative path, default fallback, protocol injection, double-slash, backslash, whitespace, `/api/...`, `/auth/...`.

**Expected behavior:** A user can complete the magic-link round-trip end-to-end. Redirect target is always a safe internal path. A successful callback always leaves the user with a synced `profiles` row, and any failure mode lands them on `/login` with a generic error tag.

---

### Task 3: Atomic profile sync via SECURITY DEFINER RPC

**Files:**
- Create: `supabase/migrations/<next-timestamp>_profile_sync_rpc.sql`
- Create: `src/lib/profiles/ensure-profile.ts`
- Test: `src/lib/profiles/ensure-profile.test.ts`
- Modify: `supabase/schema-notes.md` (document the RPC)

**Steps:**
- [x] Add a new migration introducing `public.ensure_profile(p_email text, p_display_name text default null)`:
  - `LANGUAGE plpgsql SECURITY DEFINER`.
  - `SET search_path = public, pg_temp` (lock down search path on definer functions).
  - Reads `auth.uid()` internally; raises if `null`.
  - Upserts the `profiles` row keyed on `auth_user_id = auth.uid()`. Insert path sets `auth_user_id`, `email`, `display_name`. Update path refreshes `email`/`display_name` if changed.
  - Returns the resolved `profiles` row (or just the id — pick one and document).
  - `REVOKE ALL ... FROM public;` then `GRANT EXECUTE TO authenticated;`.
- [x] Sanity-check: confirm ALEX-001's `profiles` table does not have a self-insert RLS policy. If the prior task accidentally added one, document it; do not duplicate enforcement here.
- [x] `ensure-profile.ts`: thin server-only helper that calls the RPC via the server-cookie client. Returns `{ ok: true, profile }` or `{ ok: false, reason }` — no thrown exceptions on the happy path.
- [x] Tests cover: first sign-in (insert), repeat sign-in (idempotent update with stable id), unauthenticated call (RPC raises → helper returns `{ ok: false }`), invalid email format if the RPC validates it.
- [x] Update `supabase/schema-notes.md` with: why the RPC exists, why `SECURITY DEFINER`, why search_path is pinned, why GRANT is restricted to `authenticated`, and the rule that all "user writes a row they don't yet own" flows go through scoped definer RPCs.

**Expected behavior:** Any successful auth callback can produce/refresh a `profiles` row idempotently without weakening RLS or routing through `service_role`.

---

### Task 4: Atomic workspace bootstrap via SECURITY DEFINER RPC

**Files:**
- Create: `supabase/migrations/<next-timestamp>_workspace_bootstrap_rpc.sql`
- Create: `src/lib/workspaces/create-workspace.ts`
- Test: `src/lib/workspaces/create-workspace.test.ts`
- Modify: `supabase/schema-notes.md` (document the RPC)

**Steps:**
- [x] Add a migration introducing `public.create_workspace_with_admin(p_name text, p_slug text, p_context_description text)`:
  - `LANGUAGE plpgsql SECURITY DEFINER`, pinned `search_path = public, pg_temp`.
  - Resolves `v_caller_profile_id` from `profiles` via `auth.uid()`. Raises if missing (forces the caller to have completed Task 3 first).
  - Validates inputs against the locked spec: slug shape (lowercased, kebab, length bound), `length(p_context_description) >= 30`, name non-empty.
  - In a single transaction:
    1. `INSERT INTO workspaces (name, slug, context_description, tier='basic', created_by_profile_id=v_caller_profile_id) RETURNING id INTO v_workspace_id;`
    2. `INSERT INTO workspace_members (workspace_id=v_workspace_id, profile_id=v_caller_profile_id, role='admin');`
    3. Append `audit_log_workspace` row `action='workspace_created'` only if it can be done correctly against ALEX-001's schema; otherwise leave a single explicit TODO in the RPC body referencing ALEX-003 and do not write a half-correct audit row.
  - Returns `v_workspace_id` (or the workspace row).
  - On unique-slug conflict, raise a typed `errcode = '23505'` so the caller can map it to a 409.
  - `REVOKE ALL ... FROM public; GRANT EXECUTE TO authenticated;`.
- [x] `create-workspace.ts`: server-only helper that:
  - Validates inputs client-side first (cheap fast-fail).
  - Calls the RPC via the server-cookie client.
  - Maps `23505` → `{ ok: false, reason: 'slug_taken' }`. Maps validation errors → `{ ok: false, reason: 'invalid_input', field }`. Maps unauthenticated → `{ ok: false, reason: 'unauthenticated' }`.
  - Returns `{ ok: true, workspaceId }` on success.
- [x] Tests cover: success with creator becoming admin, duplicate slug (409 mapping), context description too short, unauthenticated caller, missing `profiles` row (proves Task 3 ordering invariant).
- [x] Update `supabase/schema-notes.md` with the rationale, the audit-log TODO if any, and a note that `service_role` is **not** used by route handlers for workspace creation.

**Expected behavior:** An authenticated user with a synced profile can atomically create a workspace and become its admin via one RPC call. No path through the route handler uses naive multi-row inserts that ALEX-001 RLS would reject or admit unsafely.

---

### Task 5: Workspace creation route + minimal authenticated shell

**Files:**
- Create: `src/app/api/workspaces/route.ts`
- Modify: `src/app/page.tsx`
- Create: `src/app/workspaces/new/page.tsx`
- Test: `src/app/api/workspaces/route.test.ts`
- Test: `src/app/page.test.tsx` (or smallest viable route-level test)

**Steps:**
- [x] `POST /api/workspaces`:
  - Server-cookie client; reject if `auth.uid()` is null with 401.
  - Parse JSON body → `{ name, slug, contextDescription }`. Validate shape with explicit per-field errors.
  - Call `createWorkspace(...)`. Map results to:
    - `200 { workspaceId }` on success.
    - `409 { error: 'slug_taken' }` on duplicate slug.
    - `400 { error: 'invalid_input', field }` on validation failure.
    - `401 { error: 'unauthenticated' }` on missing session.
- [x] Home page (`src/app/page.tsx`):
  - Server component. Reads session via `server.ts` client.
  - Signed-out → render `<Link href="/login">Sign in</Link>` and a one-paragraph "what is Alexandria" stub.
  - Signed-in → render the user's email and a `<Link href="/workspaces/new">Create workspace</Link>`. If the user already has at least one membership, additionally render a placeholder list (read-only, name + slug) — no actions yet.
- [x] `workspaces/new` page:
  - Client component form with `name`, `slug`, `contextDescription` (textarea).
  - On submit, POST to `/api/workspaces`. On 200, navigate to `/` (workspace dashboards land in a later slice). On 4xx, render the field-level error inline.
- [x] Test `/api/workspaces` for: 401 unauthenticated, 400 invalid input, 409 duplicate slug, 200 success → asserts the calling user owns an admin row in the new workspace.
- [x] Light test of the home page: unauthenticated render path and authenticated render path. UI polish is out of scope.

**Expected behavior:** A new user can land on `/`, sign in, and create their first workspace through a real, RLS-respecting route handler. No invite UI is exposed.

---

### Task 6: Verification + docs cleanup

**Files:**
- Modify: `README.md`
- Modify: `supabase/schema-notes.md`
- Modify: `docs/plans/ALEX-002-auth-foundation.md` (this file — only after work is complete, to mark the slice done)

**Steps:**
- [x] Run `npm run lint && npm run typecheck && npm run test && npm run build`. All must pass.
- [x] If a local Supabase instance is reachable: apply both new migrations and execute the smoke path (sign in → callback → profile row exists → POST `/api/workspaces` → row exists, member admin row exists). Capture command output in the PR description. Not applicable in this environment; local Supabase was unreachable.
- [x] If local Supabase is **not** reachable: state the exact reason in the PR (which CLI step failed and how) and confirm migration SQL parses (`supabase db lint` or equivalent if available). Do not fabricate a smoke result. Local Supabase was unreachable; SQL parse/lint confirmation was also unavailable because `supabase db lint` requires the unreachable local DB and no local SQL parser is installed.
- [x] Update `README.md` to describe: the auth flow at a high level, the SSR client trio, the redirect-safety rule for `next`, and the RPC-driven bootstrap pattern.
- [x] Confirm `supabase/schema-notes.md` lists both new RPCs with their grant model and search_path note.

**Expected behavior:** The slice is documented, test-backed, honest about any DB/runtime gaps, and lays the foundation that ALEX-003 (invites + member management) will extend.

---

## Done criteria
- `@supabase/ssr` is wired with browser, server-cookie, and anon-server clients; the misleading `client.ts` is gone and all imports are updated.
- Middleware refreshes sessions across the App Router.
- Magic-link login → callback → safe `next` redirect works end-to-end; redirect targets are validated by a single helper with adversarial-input tests.
- A successful callback always leaves the user with a synced `profiles` row, written via a `SECURITY DEFINER` RPC granted only to `authenticated`.
- An authenticated user can create a workspace via `POST /api/workspaces` and is atomically inserted as that workspace's admin via a `SECURITY DEFINER` RPC. Slug collisions surface as 409. Unauthenticated calls are rejected. ALEX-001 RLS is unmodified.
- `service_role` is not used by any route handler in this slice for tenancy mutations.
- Repo checks (`lint`, `typecheck`, `test`, `build`) pass.
- No invite issue/accept code, no MCP path, no memory product flows are added.
- The PR description states the manual verification result honestly (success path or named blocker).

## Explicitly deferred to ALEX-003
- `workspace_invites` issue + accept routes and pages.
- Email delivery for invites.
- Member-management UI (list, role change, remove).
- Audit-log writes for workspace creation if not safely doable inside the bootstrap RPC against the current schema.
