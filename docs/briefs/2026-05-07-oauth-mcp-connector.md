# OAuth MCP Connector Brief

Date: 2026-05-07

Alexandria now supports two MCP connector modes against the same `/api/mcp`
resource.

## Preferred: Remote MCP OAuth

Use `/api/mcp` as the MCP/resource URL. If a client calls it without a valid
bearer, Alexandria returns `401` with `WWW-Authenticate` pointing at:

- Protected resource metadata: `/.well-known/oauth-protected-resource`
- Authorization server metadata: `/.well-known/oauth-authorization-server`

OAuth-capable clients can dynamically register at `/oauth/register`, start
authorization at `/oauth/authorize`, and exchange or refresh tokens at
`/oauth/token`.

The browser login step still uses Supabase Auth and the existing `/login` magic
link flow. Clients never receive Supabase JWTs or cookies; they receive opaque
Alexandria OAuth access and refresh tokens. Tokens are stored only as hashes and
map to internal `oauth_*` MCP grant keys so existing MCP RLS/RPC behavior stays
in place.

OAuth scopes are intentionally narrow:

- `memory:read` for `memory_search`, `memory_recall_recent`, and `memory_get`
- `memory:write` for `memory_save`

Alexandria re-checks active profile and workspace membership on OAuth access and
refresh, so removed members lose connector access.

## Fallback/Dev: Manual API Key

Admins can still create manual MCP keys at `/workspaces/[slug]/keys`. These keys
keep the existing `alex_<8-hex-prefix>_<32-hex-secret>` format and continue to
work as `Authorization: Bearer <key>` on `/api/mcp`.

The demo script keeps this fallback path as the default:

```bash
export ALEXANDRIA_DEMO_MCP_KEY='<one-time alex_* key>'
npm run demo:check
```

For an OAuth bearer smoke check, use:

```bash
export ALEXANDRIA_DEMO_OAUTH_TOKEN='<Alexandria OAuth access token>'
npm run demo:check
```
