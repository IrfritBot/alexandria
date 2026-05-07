# Alexandria

Repo path: `/Users/irfrit/projects/alexandria`

This is the Sprint 1 Alexandria app: a hosted, multi-tenant shared team memory service with a Next.js web shell, Supabase-backed tenancy, the v1 MCP memory tool surface, and an Inngest worker for memory classification, embedding, conflict detection, review routing, audit, and usage accounting.

## Commands

```bash
npm install
npm run dev
npm run local:mcp-jwt
npm run demo:check
npm run lint
npm run typecheck
npm run test
npm run build
```

Open `http://localhost:3000` for the authenticated shell. Signed-in users can
create a workspace, open `/workspaces/[slug]`, browse/search memories, and see
member/admin boundaries for governance surfaces.

## Local MVP Demo Flow

Use this flow for a fresh local demo database.

1. Start Supabase and apply migrations:

```bash
supabase start
supabase db reset
supabase status
```

2. Create `.env.local` from `.env.example`, then fill the local Supabase values from `supabase status`:

```bash
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
SUPABASE_MCP_EXECUTOR_JWT=<generated below>
```

Generate the MCP executor JWT with the local JWT secret from `supabase status`:

```bash
SUPABASE_JWT_SECRET='<jwt secret>' npm run local:mcp-jwt
```

Paste that command output into `SUPABASE_MCP_EXECUTOR_JWT`.

3. Run the app and worker in separate terminals:

```bash
npm run dev
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

4. Complete the browser setup:

- Open `http://localhost:3000/login`, enter a demo email, then open the local email from Inbucket at `http://localhost:54324` and follow the magic link.
- Create a workspace at `http://localhost:3000/workspaces/new`. Demo values: name `Alexandria Demo`, slug `alexandria-demo`, context `Shared demo workspace for Alexandria MVP memory save, processing, search, and governance review.`
- Open `http://localhost:3000/workspaces/alexandria-demo/keys`, create an MCP key named `MVP demo check`, and keep the one-time plaintext key.

5. Prove the core loop:

```bash
export ALEXANDRIA_DEMO_MCP_KEY='<one-time key>'
export ALEXANDRIA_DEMO_WORKSPACE_SLUG=alexandria-demo
npm run demo:check
```

`npm run demo:check` verifies health, login rendering, MCP bearer
authentication, `memory_save`, processing completion, `memory_search`, and
`memory_get`. For OAuth connector smoke checks, set
`ALEXANDRIA_DEMO_OAUTH_TOKEN` instead of `ALEXANDRIA_DEMO_MCP_KEY`; the same MCP
tool smoke path runs with that bearer. For full signed-in web browse automation,
also set `ALEXANDRIA_DEMO_COOKIE` to the browser request `Cookie` header for the
local app; otherwise the command prints the memories URL to open while signed in.

## Auth Flow

Alexandria uses Supabase magic-link auth for the web user path. `/login` sends an OTP email with an `emailRedirectTo` callback at `/auth/callback`; the callback exchanges the code for a cookie-backed session, synchronizes the user's `profiles` row through `public.ensure_profile(...)`, then redirects to a validated internal `next` path.

The only redirect helper is `src/lib/auth/safe-next.ts`. It defaults to `/` and rejects external URLs, protocol injection, double slashes, backslashes, whitespace, `/api/...`, and `/auth/...` targets.
The one narrow exception is `/oauth/authorize?...`: it is allowed as a login
continuation only so OAuth clients can carry validated `redirect_uri` values
through browser sign-in.

## Supabase Clients

The app has four Supabase client entrypoints:

- `src/lib/supabase/browser.ts` creates the browser auth client for client components.
- `src/lib/supabase/server.ts` creates the cookie-aware SSR client for route handlers, server actions, and server components.
- `src/lib/supabase/anon-server.ts` creates the non-auth-bearing anon server client used where no user session is expected.
- `src/lib/supabase/mcp-executor.ts` creates the MCP tenant-data client. It sends the anon API key plus a JWT whose role claim is `mcp_session_executor`, so RLS applies to MCP memory reads and writes.

The old `src/lib/supabase/client.ts` name was intentionally removed because it hid the difference between anon server access and cookie-backed user sessions. Middleware refreshes Supabase Auth cookies on App Router requests.

## RPC Bootstrap Pattern

First-write tenancy flows use narrowly scoped Postgres `SECURITY DEFINER` RPCs rather than route-handler `service_role` mutations:

- `public.ensure_profile(p_email, p_display_name)` reads `auth.uid()` internally and upserts the caller's profile after magic-link callback.
- `public.create_workspace_with_admin(p_name, p_slug, p_context_description)` validates workspace input, creates the workspace, inserts the creator as `admin`, and writes the workspace audit row atomically.

Both functions pin `search_path = public, pg_temp`, revoke public execution, and grant execute only to `authenticated`.

MCP key verification is the exception: `public.verify_mcp_api_key(...)` is callable only by `service_role` because it checks bcrypt key hashes. After verification, MCP tenant reads and writes do not use `service_role`; the route calls invoker RPCs as `mcp_session_executor`. Those functions call `set_mcp_session(workspace_id, mcp_key_id)` and let RLS enforce workspace scope for `memories`, `memory_revisions`, normalized `workspace_tags`, `memory_tags`, audit, and usage rows.

## Routes

- `GET /api/health` returns a 200 JSON health payload.
- `GET /api/mcp` and `POST /api/mcp` `tools/list` return the authenticated v1 tool catalog; `POST /api/mcp` dispatches `memory_save`, `memory_search`, `memory_recall_recent`, and `memory_get`.
- `GET /.well-known/oauth-protected-resource` advertises `/api/mcp` as the MCP OAuth resource.
- `GET /.well-known/oauth-authorization-server` advertises the OAuth authorize, token, and dynamic registration endpoints.
- `POST /oauth/register` dynamically registers public MCP OAuth clients.
- `GET /oauth/authorize` and `POST /oauth/authorize` guide signed-in users through workspace/scopes consent.
- `POST /oauth/token` exchanges PKCE authorization codes and rotates refresh tokens for Alexandria OAuth bearer tokens.
- `GET /api/inngest`, `POST /api/inngest`, and `PUT /api/inngest` serve the Inngest worker functions.
- `GET /login` renders the magic-link sign-in form.
- `GET /auth/callback` exchanges Supabase auth codes, syncs profiles, and safely redirects.
- `POST /api/workspaces` creates a workspace through the bootstrap RPC.
- `GET /workspaces/new` renders the minimal workspace creation form.
- `GET /workspaces/[slug]` renders the authenticated workspace dashboard.
- `GET /workspaces/[slug]/memories` browses and full-text searches workspace-scoped memories.
- `GET /workspaces/[slug]/memories/[memoryId]` renders a read-only memory detail page with tags and recent revisions.
- `GET /workspaces/[slug]/keys` renders admin-only MCP key list/create/revoke controls.
- `POST /workspaces/[slug]/keys/create` creates an MCP key through `public.issue_mcp_key(...)` and returns the one-time plaintext value without putting it in the URL.
- `POST /workspaces/[slug]/keys/[keyId]/revoke` revokes an MCP key through `public.revoke_mcp_key(...)`.
- `GET /workspaces/[slug]/conflicts` renders the admin-only unresolved conflict queue.
- `GET /workspaces/[slug]/audit` renders a minimal admin-only read-only audit log shell.
- `GET /workspaces/[slug]/usage` renders a minimal admin-only read-only usage shell.

Workspace web routes use the cookie-backed Supabase server client and RLS-backed
membership lookup. They do not import the service-role client; MCP key material
is issued/revoked through authenticated RPCs that enforce workspace admin
membership in Postgres.

## MCP HTTP Contract

Alexandria supports two MCP connector modes:

- Preferred remote connector: point the client at `/api/mcp`. Unauthenticated
  calls return a `WWW-Authenticate` header with
  `resource_metadata="<origin>/.well-known/oauth-protected-resource"`. OAuth
  clients can then discover `/oauth/register`, `/oauth/authorize`, and
  `/oauth/token`, send the user through the existing Supabase web login and
  consent page, and use Alexandria bearer tokens for MCP calls.
- Fallback/dev connector: create a manual MCP API key in
  `/workspaces/[slug]/keys` and send it as `Authorization: Bearer <key>`.

OAuth connector tokens are Alexandria-owned opaque tokens. They are stored only
as hashes, map to an internal `oauth_*` MCP grant key for the existing RLS/RPC
path, and do not expose Supabase JWTs, Supabase cookies, service-role keys, or
raw token hashes to clients. Access tokens are scoped to `memory:read` and/or
`memory:write`, and profile/workspace membership is re-checked on token use and
refresh.

MCP API keys use `alex_<8-hex-prefix>_<32-hex-secret>`. The prefix is stored for lookup; the full presented key is checked against the stored bcrypt hash and revoked keys are rejected.

OAuth/MCP endpoint URLs:

- MCP/resource URL: `/api/mcp`
- Protected resource metadata: `/.well-known/oauth-protected-resource`
- Authorization server metadata: `/.well-known/oauth-authorization-server`
- Dynamic registration: `/oauth/register`
- Authorization/consent: `/oauth/authorize`
- Token exchange/refresh: `/oauth/token`

`POST /api/mcp` accepts a Bearer key and the locked v1 tools: `memory_save`, `memory_search`, `memory_recall_recent`, and `memory_get`. A direct `memory_save` body looks like:

```json
{
  "method": "memory_save",
  "params": {
    "content": "Remember the Friday deployment freeze.",
    "tags": ["Policy", "release notes"]
  }
}
```

On success it returns `202`:

```json
{
  "ok": true,
  "service": "alexandria",
  "surface": "mcp",
  "method": "memory_save",
  "memory_id": "<uuid>",
  "status": "processing",
  "message": "Memory accepted for processing."
}
```

The synchronous save path trims content, normalizes tags to lowercase slug names, writes a `processing` memory plus initial revision/tag/audit/usage rows, and enqueues the Inngest event `memory/process.requested`. Read tools return only workspace-scoped, active, non-deleted memories with tags, source metadata, and author labels; `memory_get` returns 404 for missing or cross-workspace IDs.

## Memory Worker

`POST /api/mcp` does not call model providers directly: it enqueues `memory/process.requested`, and `src/lib/memory/inngest.ts` serves the `memory-process-v1` Inngest function through `/api/inngest`.

The worker loads the processing memory, classifies kind, creates an embedding, retrieves active same-kind conflict candidates, writes conflict rows, records a revision, updates the memory, and appends audit/usage rows. Basic workspaces use the Anthropic basic classifier model and OpenAI embeddings. Pro workspaces use the Anthropic pro classifier model and Voyage embeddings when configured.

Classifier output with confidence `<= 0.6` is preserved as kind/confidence metadata but routes the memory to `status='conflict'` for admin review and suppresses auto-resolution. Classifier provider failures also route to `status='conflict'` with `kind='unknown'` and failure metadata. Embedder provider failures mark the memory `status='failed'` with inspectable processing metadata.

Auto-resolution is intentionally narrow: only active, same-kind candidates can be auto-resolved. `conflict` status candidates, `unknown` kind candidates, judgment memories, classifier failures, low-confidence classifications, and mixed multi-candidate sets remain unresolved for admin review and do not update `superseded_by_memory_id` on older memories.

## Spec Mapping

- Next.js App Router covers the future web UI, API route handlers, and MCP HTTP entrypoint in one repo.
- Supabase helper code includes browser, cookie-backed server, service-role, and anon-server clients, with user auth and workspace bootstrap using Supabase Auth plus scoped RPCs.
- Inngest handles the async `memory/process.requested` worker path for classify/embed/conflict/finalize behavior.
- ALEX-007 adds the minimal web governance shell: authenticated dashboard, memory browse/search/detail, MCP key management, unresolved conflict queue, and read-only audit/usage views.
- Full invite/member management, conflict resolution actions, and destructive memory CRUD remain follow-up work.
