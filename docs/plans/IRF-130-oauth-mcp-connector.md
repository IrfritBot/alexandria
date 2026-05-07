# IRF-130: Alexandria OAuth Remote MCP Connector Implementation Plan

**Goal:** Let a remote MCP/connector client connect to Alexandria with browser-based OAuth login/consent instead of manual `alex_*` API keys.

**Architecture:** Keep Supabase Auth as the human identity/session layer. Alexandria becomes the OAuth authorization server/resource server for MCP: discovery metadata advertises OAuth, `/oauth/authorize` uses the existing Supabase web session to collect workspace/scopes consent, `/oauth/token` exchanges PKCE codes for Alexandria bearer tokens, and `/api/mcp` accepts those tokens alongside existing API keys. To reuse the current RLS/RPC path safely, each OAuth grant creates an internal `mcp_keys` row named as an OAuth connector grant; MCP RPCs still run as `mcp_session_executor` with that key id.

**Constraints:**
- DO NOT remove or break existing `alex_*` MCP API keys.
- DO NOT expose Supabase JWTs, Supabase cookies, service-role keys, or raw OAuth token hashes to clients.
- DO NOT deploy or mutate production env/config in this task.
- DO NOT change memory processing/Inngest behavior.
- DO NOT relax `safe-next.ts` globally; only allow a narrowly validated OAuth authorize continuation.
- DO NOT let OAuth access survive removed workspace membership; re-check active profile + workspace membership on every access-token validation and refresh.
- DO NOT implement OAuth code/token redemption as select-then-update; one-time consume/rotate must be atomic.
- DO NOT add paid dependencies unless unavoidable; prefer Node `crypto` and existing Supabase client.
- Keep scope tight: OAuth connector MVP only, not full user/team invite management.

---

## Expected user flow

1. Client is configured with MCP URL: `https://alexandria-sage.vercel.app/api/mcp`.
2. Client calls `/api/mcp` without auth and receives a `401` with `WWW-Authenticate` pointing at protected-resource metadata.
3. Client discovers Alexandria OAuth metadata.
4. Client registers dynamically if needed, starts authorization-code + PKCE flow.
5. User signs in through existing `/login`, returns to `/oauth/authorize`, chooses workspace and scopes, approves.
6. Client exchanges code for bearer token.
7. Client calls `/api/mcp` with `Authorization: Bearer <access_token>`.

---

## Task 1: OAuth schema migration

**Files:**
- Create: `supabase/migrations/20260507123000_oauth_remote_mcp_connector.sql`
- Test/update: `supabase/validation/alex_005_oauth_connector.test.ts`

**Steps:**
- [ ] Create tables:
  - `public.oauth_clients`
    - `id uuid primary key default extensions.gen_random_uuid()`
    - `client_id text not null unique`
    - `client_name text not null`
    - `redirect_uris jsonb not null`
    - `created_at`, `updated_at`
    - constraints: non-empty client id/name; `redirect_uris` is non-empty JSON array
  - `public.oauth_authorization_codes`
    - `id uuid primary key default extensions.gen_random_uuid()`
    - `code_hash text not null unique`
    - `client_id text not null references public.oauth_clients(client_id)`
    - `redirect_uri text not null`
    - `code_challenge text not null`
    - `code_challenge_method text not null default 'S256'`
    - `profile_id uuid not null references public.profiles(id)`
    - `workspace_id uuid not null references public.workspaces(id)`
    - `scopes text[] not null default '{}'::text[]`
    - `expires_at timestamptz not null`
    - `consumed_at timestamptz`
    - `created_at timestamptz not null default now()`
  - `public.oauth_access_tokens`
    - `id uuid primary key default extensions.gen_random_uuid()`
    - `token_hash text not null unique`
    - `refresh_token_hash text unique`
    - `client_id text not null references public.oauth_clients(client_id)`
    - `profile_id uuid not null references public.profiles(id)`
    - `workspace_id uuid not null references public.workspaces(id)`
    - `mcp_key_id uuid not null references public.mcp_keys(id)`
    - `scopes text[] not null default '{}'::text[]`
    - `expires_at timestamptz not null`
    - `refresh_expires_at timestamptz`
    - `last_used_at timestamptz`
    - `revoked_at timestamptz`
    - `created_at timestamptz not null default now()`
- [ ] Add indexes for token/code lookup and workspace/client visibility:
  - token/code hash indexes are covered by unique constraints.
  - add `(workspace_id, profile_id, created_at desc)` on tokens.
  - add `(client_id, created_at desc)` on codes/tokens.
- [ ] Enable RLS on all OAuth tables and grant no table access to `anon`, `authenticated`, or `mcp_session_executor`; only service-role server code should touch them for now.
- [ ] Do not modify existing `mcp_keys` schema.
- [ ] Add private RPCs/functions for atomic OAuth one-time operations, callable only through service-role/server code (revoke from public/anon/authenticated/mcp executor):
  - `public.consume_oauth_authorization_code(p_code_hash text)` updates one matching unconsumed/unexpired code to `consumed_at = now()` and returns the code row in one statement. It is acceptable for mismatched redirect/PKCE attempts to consume the code after lookup; never allow replay.
  - `public.rotate_oauth_refresh_token(p_client_id text, p_refresh_token_hash text, p_new_token_hash text, p_new_refresh_token_hash text, p_access_expires_at timestamptz, p_refresh_expires_at timestamptz)` atomically revokes/replaces refresh state or inserts the new token row tied to the same grant, depending on the final table design.
  - If the implementer chooses service-role conditional `update ... returning` instead of RPC, tests must still prove atomic one-time behavior and no select-then-update replay window.
- [ ] Add validation tests that assert table names, RLS enabled, no broad grants, token/code hash uniqueness, and atomic consume/rotate function presence or equivalent conditional-update tests.

**Expected behavior:** Migration applies cleanly and creates private OAuth storage without changing current API-key behavior.

---

## Task 2: OAuth crypto, scopes, and client helpers

**Files:**
- Create: `src/lib/oauth/crypto.ts`
- Create: `src/lib/oauth/scopes.ts`
- Create: `src/lib/oauth/clients.ts`
- Create: `src/lib/oauth/crypto.test.ts`
- Create: `src/lib/oauth/scopes.test.ts`
- Create: `src/lib/oauth/clients.test.ts`
- Create: `src/lib/oauth/csrf.ts`
- Create: `src/lib/oauth/csrf.test.ts`

**Steps:**
- [ ] `crypto.ts`:
  - implement `randomToken(byteLength = 32)` using base64url.
  - implement `sha256Token(token)` returning hex.
  - implement `verifyPkce({ verifier, challenge, method })` for `S256`; allow `plain` only if explicitly needed by tests/spec fallback.
  - reject short/invalid code verifiers according to OAuth-safe bounds: 43-128 chars, unreserved chars only.
- [ ] `scopes.ts`:
  - define allowed scopes: `memory:read`, `memory:write`.
  - parse/normalize space-delimited scope strings.
  - default to both read/write if scope omitted for MCP connector simplicity.
  - expose `hasScope(session, scope)` helper; API-key sessions should effectively have both scopes.
- [ ] `clients.ts`:
  - implement redirect URI validation.
  - allow `https://...` redirect URIs and local dev loopback redirects (`http://localhost`, `http://127.0.0.1`, `[::1]`) for desktop clients.
  - reject wildcard, relative, `javascript:`, non-http(s), and empty redirect URIs.
  - implement client payload normalization for dynamic registration.
- [ ] `csrf.ts`:
  - implement `createOauthCsrfToken()` using random base64url.
  - implement constant-time `verifyOauthCsrfToken(cookieToken, formToken)`.
  - expose cookie name/options helper for short-lived, `HttpOnly`, `SameSite=Lax`, `Secure` in production.
- [ ] Tests cover positive and negative PKCE, scope, redirect URI, and CSRF cases.

**Expected behavior:** OAuth primitives are deterministic, tested, and independent from route handlers.

---

## Task 3: OAuth discovery metadata

**Files:**
- Create: `src/lib/oauth/metadata.ts`
- Create: `src/app/.well-known/oauth-protected-resource/route.ts`
- Create: `src/app/.well-known/oauth-authorization-server/route.ts`
- Create: `src/app/.well-known/oauth-protected-resource/route.test.ts`
- Create: `src/app/.well-known/oauth-authorization-server/route.test.ts`
- Modify: `src/app/api/mcp/route.ts`
- Update: `src/app/api/mcp/route.test.ts`
- Modify: `src/lib/auth/safe-next.ts`
- Update: `src/lib/auth/safe-next.test.ts`

**Steps:**
- [ ] `metadata.ts` builds absolute URLs from `NEXT_PUBLIC_APP_URL` if set, otherwise request origin.
- [ ] Protected-resource metadata route returns JSON including:
  - `resource`: `<origin>/api/mcp`
  - `authorization_servers`: [`<origin>`]
  - optional `scopes_supported`: [`memory:read`, `memory:write`]
- [ ] Authorization-server metadata route returns JSON including:
  - `issuer`
  - `authorization_endpoint`
  - `token_endpoint`
  - `registration_endpoint`
  - `response_types_supported: ["code"]`
  - `grant_types_supported: ["authorization_code", "refresh_token"]`
  - `code_challenge_methods_supported: ["S256"]`
  - `token_endpoint_auth_methods_supported: ["none"]`
  - `scopes_supported`
- [ ] Change MCP `unauthorizedResponse()` to include a `WWW-Authenticate` header with both `Bearer` and `resource_metadata="<origin>/.well-known/oauth-protected-resource"`.
- [ ] Add a narrow safe-next OAuth continuation exception: `/oauth/authorize?...` is allowed even when query params contain encoded `https://` redirect URIs, but only when the decoded path is exactly `/oauth/authorize`, has no backslashes/whitespace, and still starts with `/`. Keep `/api`, `/auth`, external URLs, `//`, arbitrary paths with `:` in query, and non-authorize OAuth paths rejected.
- [ ] Add tests proving `/login?next=/oauth/authorize?...redirect_uri=https%3A%2F%2F...` survives while `/foo?x=https://evil`, `//evil`, `/auth/...`, and `/api/...` remain rejected.
- [ ] Tests assert metadata shape and the 401 header.

**Expected behavior:** OAuth-capable MCP clients can discover login/token endpoints automatically from `/api/mcp`.

---

## Task 4: Dynamic client registration

**Files:**
- Create: `src/app/oauth/register/route.ts`
- Create: `src/app/oauth/register/route.test.ts`
- Modify if needed: `src/lib/oauth/clients.ts`

**Steps:**
- [ ] Implement `POST /oauth/register` for public clients.
- [ ] Input accepts `client_name` and `redirect_uris`.
- [ ] Validate redirect URIs with Task 2 helper.
- [ ] Store client through service-role Supabase into `oauth_clients`.
- [ ] Generate opaque `client_id` (`alex_client_<random>` or similar); no client secret.
- [ ] Return RFC-style registration payload:
  - `client_id`
  - `client_id_issued_at`
  - `client_name`
  - `redirect_uris`
  - `token_endpoint_auth_method: "none"`
  - `grant_types: ["authorization_code", "refresh_token"]`
  - `response_types: ["code"]`
- [ ] Tests mock Supabase and assert success, invalid redirect rejection, and service failure behavior.

**Expected behavior:** Claude/Codex-style clients that support dynamic registration can register without manual setup.

---

## Task 5: Authorization consent page and code issuing

**Files:**
- Create: `src/lib/oauth/authorize.ts`
- Create: `src/lib/oauth/authorize.test.ts`
- Create: `src/app/oauth/authorize/route.ts`
- Create: `src/app/oauth/authorize/route.test.ts`
- Modify/test: `src/lib/auth/safe-next.ts` behavior from Task 3 must be present before relying on `/login?next=...`.
- Reuse: existing `/login?next=...` flow; do not create a new login system.

**Steps:**
- [ ] `GET /oauth/authorize` validates query params:
  - `response_type=code`
  - known `client_id`
  - exact `redirect_uri` registered for the client
  - `code_challenge` present
  - `code_challenge_method=S256`
  - optional `state`
  - optional `scope`
- [ ] If no Supabase user session, redirect to `/login?next=<encoded current OAuth authorize URL>`; this must be covered by the Task 3 safe-next OAuth exception tests so redirect_uri values containing `https://` are not lost.
- [ ] If signed in, query profile and workspace memberships for the user.
- [ ] Render simple HTML consent form listing:
  - client name
  - workspace select
  - scopes requested
  - approve button
  - hidden CSRF token from `src/lib/oauth/csrf.ts`
- [ ] Set an OAuth consent CSRF cookie on the GET response and require the hidden token to match the cookie on POST. Clear/rotate it after POST.
- [ ] `POST /oauth/authorize` verifies CSRF first, then revalidates all hidden fields server-side, verifies selected workspace membership, creates a short-lived authorization code row (10 minutes), then redirects to `redirect_uri?code=...&state=...`.
- [ ] On denial/invalid input, redirect with standard `error` and preserve `state` when safe.
- [ ] Tests cover login redirect preserving OAuth authorize URL, invalid client/redirect/challenge, consent rendering, CSRF rejection, membership enforcement, and successful code redirect.

**Expected behavior:** A logged-in user can approve a connector for exactly one workspace and requested scopes.

---

## Task 6: Token endpoint and OAuth grant token storage

**Files:**
- Create: `src/lib/oauth/tokens.ts`
- Create: `src/lib/oauth/tokens.test.ts`
- Create: `src/app/oauth/token/route.ts`
- Create: `src/app/oauth/token/route.test.ts`

**Steps:**
- [ ] Implement `POST /oauth/token` for `application/x-www-form-urlencoded` requests.
- [ ] Authorization-code grant:
  - validate `grant_type=authorization_code`, `client_id`, `code`, `redirect_uri`, `code_verifier`.
  - atomically consume exactly one unconsumed, unexpired code by `sha256Token(code)` using Task 1 RPC/conditional-update semantics. Never do plain select-then-update.
  - verify client/redirect match.
  - verify PKCE.
  - re-check that `profile_id` is active and still a member of `workspace_id`; reject if membership was removed after consent.
  - create internal `mcp_keys` row with:
    - workspace id from code
    - name like `OAuth connector: <client_name>`
    - key_prefix like `oauth_<8 hex>`
    - key_hash as a non-secret sentinel hash; never accepted by API-key verifier
    - created_by_profile_id from code
  - create access token and refresh token rows with hashed values.
  - mark code consumed.
  - return bearer JSON: `access_token`, `token_type: "Bearer"`, `expires_in`, `refresh_token`, `scope`.
- [ ] Refresh-token grant:
  - validate `grant_type=refresh_token`, `client_id`, `refresh_token`.
  - atomically validate and rotate refresh token using Task 1 RPC/conditional-update semantics. Never allow two refresh attempts to both succeed.
  - reject revoked/expired refresh tokens.
  - re-check active profile + workspace membership before issuing new access.
  - rotate access token and refresh token.
- [ ] Token lifetimes: access 1 hour; refresh 30 days.
- [ ] Tests cover success, replayed/consumed code rejection, expired code rejection, PKCE failure, redirect mismatch, membership removed after consent, refresh success, refresh replay rejection, refresh after membership removal, and invalid refresh rejection.

**Expected behavior:** Clients can exchange consent for tokens without static Alexandria API keys.

---

## Task 7: Accept OAuth bearer tokens in MCP route

**Files:**
- Modify: `src/lib/mcp/api-keys.ts`
- Modify: `src/lib/mcp/api-key-validation.ts`
- Modify: `src/app/api/mcp/route.ts`
- Update: `src/lib/mcp/api-keys.test.ts`
- Update: `src/lib/mcp/api-key-validation.test.ts`
- Update: `src/app/api/mcp/route.test.ts`

**Steps:**
- [ ] Extend `ValidMcpSession` with optional OAuth metadata:
  - `authKind: "api_key" | "oauth"`
  - `scopes?: string[]`
  - `profileId?: string`
  - `clientId?: string`
  - keep `workspaceId` and `mcpKeyId` required for RPC compatibility.
- [ ] Keep API-key validation unchanged for `alex_<prefix>_<secret>`.
- [ ] If the bearer token is not a valid `alex_*` API key, validate it as OAuth access token via `src/lib/oauth/tokens.ts`.
- [ ] OAuth validation must:
  - hash token
  - find active unexpired token
  - ensure linked internal `mcp_keys` row is not revoked
  - re-check `profile_id` is active and still a member of `workspace_id` on every MCP request; reject otherwise and best-effort revoke the token/internal grant.
  - update token/key `last_used_at` best-effort
  - return a `ValidMcpSession` with scopes.
- [ ] In `src/app/api/mcp/route.ts`, require:
  - `memory_save` => `memory:write`
  - `memory_search`, `memory_recall_recent`, `memory_get` => `memory:read`
  - API-key sessions bypass scope checks as full-access legacy connectors.
- [ ] Return `403` JSON `{ error: "insufficient_scope" }` for OAuth tokens missing needed scope.
- [ ] Existing API-key tests must still pass.
- [ ] Add tests proving internal OAuth grant key rows (`key_prefix` beginning with `oauth_` and sentinel hash/key material) cannot authenticate through `parseMcpApiKey`, `validateMcpApiKey`, or the legacy `/api/mcp` API-key path.

**Expected behavior:** `/api/mcp` supports both old API keys and new OAuth access tokens with scoped authorization.

---

## Task 8: MCP/OAuth docs and demo script support

**Files:**
- Modify: `README.md`
- Modify: `.env.example` if new env vars are introduced
- Modify: `scripts/demo-check.mjs` only if needed; do not break API-key demo check.
- Create: `docs/briefs/2026-05-07-oauth-mcp-connector.md`

**Steps:**
- [ ] Document two connector modes:
  - preferred: remote MCP OAuth connector via `/api/mcp`
  - fallback/dev: manual `alex_*` API key
- [ ] Include exact URLs:
  - MCP/resource URL: `/api/mcp`
  - protected resource metadata
  - authorization server metadata
  - register/authorize/token endpoints
- [ ] Document that Supabase Auth remains the login system but clients receive Alexandria OAuth tokens, not Supabase tokens.
- [ ] If demo script changes, keep existing API-key smoke green and add an optional OAuth token env path.

**Expected behavior:** Mike/Henry can explain and test the connector flow without reading source.

---

## Task 9: Verification gate

**Files:**
- No new files unless tests need minor fixtures.

**Steps:**
- [ ] Run focused tests for OAuth files.
- [ ] Run full gates:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run build`
  - `git diff --check`
- [ ] Run at least one local/manual HTTP smoke if feasible:
  - unauthenticated `/api/mcp` returns OAuth discovery header.
  - metadata routes return expected JSON.
  - dynamic registration rejects bad redirect and accepts localhost/https redirect.
- [ ] Commit with message: `feat: add oauth remote mcp connector`.

**Expected behavior:** Implementation is ready for review, but not deployed.

---

## Out of scope / follow-ups

- Native screenshots beyond the simple consent HTML are not required unless the implementation adds styled UI.
- Full OAuth app management UI is out of scope.
- Token revocation endpoint is out of scope unless trivial; token expiry + refresh rotation is enough for this task.
- Per-user authored memory attribution inside `memories.author_profile_id` is a follow-up. This MVP preserves auditability through the OAuth token row and its internal `mcp_keys.created_by_profile_id` grant row while reusing the existing MCP RLS path.

---

## Plan-review security fixes baked in

The first plan review found five blockers; implementation must explicitly cover all of them:

1. `/login?next=...` currently rejects `:` in query strings. OAuth login continuation must be handled via a narrow `/oauth/authorize` exception in `safe-next.ts` with tests, not a broad relaxation.
2. OAuth access/refresh validation must re-check active profile + workspace membership every time so removed users lose access.
3. Authorization-code consumption and refresh-token rotation must be atomic and have replay/race-oriented tests.
4. Consent POST must include CSRF protection.
5. Internal `oauth_*`/sentinel `mcp_keys` rows must not authenticate through the legacy `alex_*` API-key verifier; add tests proving this.
- Production deploy is a separate Henry approval gate.
