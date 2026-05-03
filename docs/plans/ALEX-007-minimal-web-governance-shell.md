# ALEX-007 Minimal Web Governance Shell

Implemented in this slice:

- Authenticated workspace dashboard at `/workspaces/[slug]`.
- Workspace-scoped memory browse/search at `/workspaces/[slug]/memories`.
- Read-only memory detail at `/workspaces/[slug]/memories/[memoryId]`.
- Admin-only MCP key list/create/revoke at `/workspaces/[slug]/keys`.
- Admin-only unresolved conflict queue at `/workspaces/[slug]/conflicts`.
- Admin-only read-only audit and usage shells at `/workspaces/[slug]/audit` and `/workspaces/[slug]/usage`.

Security posture:

- Web routes use `createSupabaseServerClient()` and rely on authenticated user RLS.
- Workspace access is loaded through workspace slug, caller profile, and exact `workspace_members` row.
- Admin-only surfaces check the caller role before querying admin-scoped tables.
- MCP key create/revoke use the existing authenticated RPCs; plaintext keys are returned only once after creation and are not placed in URLs.
- The workspace web route test suite asserts these routes do not import the service-role client.

Follow-up:

- Add invite/member management.
- Add conflict resolution actions and audit notes.
- Add richer memory author/member display once profile joins are finalized.
- Add pagination for large audit, usage, conflict, and memory result sets.
