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

## Routes

- `GET /api/health` returns a 200 JSON health payload.
- `GET /api/mcp` and `POST /api/mcp` are explicit not-yet-implemented MCP stubs.
- `GET /api/inngest` and `POST /api/inngest` are compile-safe worker route stubs.

## Spec Mapping

- Next.js App Router covers the future web UI, API route handlers, and MCP HTTP entrypoint in one repo.
- Supabase helper code and an initial Postgres/Auth/pgvector schema migration are present, but no auth flows are included yet.
- Inngest structure is present for the future async write pipeline, but no worker behavior is implemented yet.
- No memory CRUD, product UI, secrets, or invented architecture are included in this bootstrap.
