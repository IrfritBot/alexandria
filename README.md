# Alexandria

Repo path: `/Users/irfrit/projects/alexandria`

This is the Sprint 1A bootstrap skeleton for Alexandria: a hosted, multi-tenant shared team memory app with a future MCP surface. It intentionally includes only the executable shell from the locked spec: Next.js App Router, route-handler API stubs, Supabase wiring, Inngest wiring, and an environment contract.

## Commands

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm run test
npm run build
```

Open `http://localhost:3000` for the minimal authenticated shell.

## Auth Flow

Alexandria uses Supabase magic-link auth for the web user path. `/login` sends an OTP email with an `emailRedirectTo` callback at `/auth/callback`; the callback exchanges the code for a cookie-backed session, synchronizes the user's `profiles` row through `public.ensure_profile(...)`, then redirects to a validated internal `next` path.

The only redirect helper is `src/lib/auth/safe-next.ts`. It defaults to `/` and rejects external URLs, protocol injection, double slashes, backslashes, whitespace, `/api/...`, and `/auth/...` targets.

## Supabase Clients

The app has three Supabase client entrypoints:

- `src/lib/supabase/browser.ts` creates the browser auth client for client components.
- `src/lib/supabase/server.ts` creates the cookie-aware SSR client for route handlers, server actions, and server components.
- `src/lib/supabase/anon-server.ts` creates the non-auth-bearing anon server client used where no user session is expected.

The old `src/lib/supabase/client.ts` name was intentionally removed because it hid the difference between anon server access and cookie-backed user sessions. Middleware refreshes Supabase Auth cookies on App Router requests.

## RPC Bootstrap Pattern

First-write tenancy flows use narrowly scoped Postgres `SECURITY DEFINER` RPCs rather than route-handler `service_role` mutations:

- `public.ensure_profile(p_email, p_display_name)` reads `auth.uid()` internally and upserts the caller's profile after magic-link callback.
- `public.create_workspace_with_admin(p_name, p_slug, p_context_description)` validates workspace input, creates the workspace, inserts the creator as `admin`, and writes the workspace audit row atomically.

Both functions pin `search_path = public, pg_temp`, revoke public execution, and grant execute only to `authenticated`.

## Routes

- `GET /api/health` returns a 200 JSON health payload.
- `GET /api/mcp` is an authenticated not-yet-implemented discovery stub; `POST /api/mcp` accepts the first `memory_save` write path.
- `GET /api/inngest` and `POST /api/inngest` are compile-safe worker route stubs.
- `GET /login` renders the magic-link sign-in form.
- `GET /auth/callback` exchanges Supabase auth codes, syncs profiles, and safely redirects.
- `POST /api/workspaces` creates a workspace through the bootstrap RPC.
- `GET /workspaces/new` renders the minimal workspace creation form.

## Spec Mapping

- Next.js App Router covers the future web UI, API route handlers, and MCP HTTP entrypoint in one repo.
- Supabase helper code includes browser, cookie-backed server, service-role, and anon-server clients, with user auth and workspace bootstrap using Supabase Auth plus scoped RPCs.
- Inngest structure is present for the future async write pipeline, but no worker behavior is implemented yet.
- No memory CRUD, product UI, secrets, or invented architecture are included in this bootstrap.
