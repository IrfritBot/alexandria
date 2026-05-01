# Alexandria

Repo path: `/Users/irfrit/projects/alexandria`

This is the Sprint 1A bootstrap skeleton for Alexandria: a hosted, multi-tenant shared team memory app with a future MCP surface. It intentionally includes only the executable shell from the locked spec: Next.js App Router, route-handler API stubs, Supabase wiring, Inngest wiring, and an environment contract.

## Commands

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm run build
```

Open `http://localhost:3000` for the minimal home page.

## Supabase Clients

The app has three Supabase client entrypoints:

- `src/lib/supabase/browser.ts` creates the browser auth client for client components.
- `src/lib/supabase/server.ts` creates the cookie-aware SSR client for route handlers, server actions, and server components.
- `src/lib/supabase/anon-server.ts` creates the non-auth-bearing anon server client used where no user session is expected.

The old `src/lib/supabase/client.ts` name was intentionally removed because it hid the difference between anon server access and cookie-backed user sessions. Middleware refreshes Supabase Auth cookies on App Router requests.

## Routes

- `GET /api/health` returns a 200 JSON health payload.
- `GET /api/mcp` and `POST /api/mcp` are explicit not-yet-implemented MCP stubs.
- `GET /api/inngest` and `POST /api/inngest` are compile-safe worker route stubs.

## Spec Mapping

- Next.js App Router covers the future web UI, API route handlers, and MCP HTTP entrypoint in one repo.
- Supabase helper code and an initial Postgres/Auth/pgvector schema migration are present, but no auth flows are included yet.
- Inngest structure is present for the future async write pipeline, but no worker behavior is implemented yet.
- No memory CRUD, product UI, secrets, or invented architecture are included in this bootstrap.
