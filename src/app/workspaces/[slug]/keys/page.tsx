import { listMcpKeys } from "@/lib/mcp/api-keys";
import {
  isWorkspaceAdmin,
  requireWorkspaceContext,
} from "@/lib/web/workspace-context";

import {
  WorkspaceShell,
  workspaceStyles as styles,
} from "../_components/workspace-shell";

export const dynamic = "force-dynamic";

type KeysPageProps = {
  params: Promise<{
    slug: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string | null) {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function McpKeysPage({
  params,
  searchParams,
}: KeysPageProps) {
  const { slug } = await params;
  const queryParams = (await searchParams) ?? {};
  const error = firstParam(queryParams.error);
  const revoked = firstParam(queryParams.revoked);
  const context = await requireWorkspaceContext({
    nextPath: `/workspaces/${slug}/keys`,
    slug,
  });
  const isAdmin = isWorkspaceAdmin(context);
  const result = isAdmin
    ? await listMcpKeys(
        {
          workspaceId: context.workspace.id,
        },
        context.supabase as never,
      )
    : null;

  return (
    <WorkspaceShell active="keys" context={context}>
      <section className={styles.section} aria-labelledby="keys-title">
        <h2 id="keys-title">MCP keys</h2>
        {!isAdmin ? (
          <div className={styles.adminOnly}>
            MCP key management is available to workspace admins only.
          </div>
        ) : (
          <>
            {error ? (
              <div className={styles.notice} role="alert">
                Unable to update MCP keys. Check the key name and admin access.
              </div>
            ) : null}
            {revoked ? (
              <div className={styles.notice} role="status">
                MCP key revoked.
              </div>
            ) : null}
            <form
              action={`/workspaces/${context.workspace.slug}/keys/create`}
              className={styles.toolbar}
              method="post"
            >
              <div className={styles.field}>
                <label htmlFor="name">Key name</label>
                <input
                  className={styles.input}
                  id="name"
                  maxLength={120}
                  minLength={1}
                  name="name"
                  required
                />
              </div>
              <button className={styles.button} type="submit">
                Create key
              </button>
            </form>
          </>
        )}
      </section>

      {isAdmin ? (
        <section className={styles.section} aria-labelledby="keys-list-title">
          <h2 id="keys-list-title">Issued keys</h2>
          {!result?.ok ? (
            <div className={styles.notice} role="alert">
              Unable to load MCP keys.
            </div>
          ) : result.keys.length === 0 ? (
            <div className={styles.notice}>No MCP keys issued.</div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Prefix</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Last used</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {result.keys.map((key) => (
                    <tr key={key.id}>
                      <td>{key.name}</td>
                      <td>{key.keyPrefix}</td>
                      <td>{key.revokedAt ? "Revoked" : "Active"}</td>
                      <td>{formatDate(key.createdAt)}</td>
                      <td>{formatDate(key.lastUsedAt)}</td>
                      <td>
                        {key.revokedAt ? null : (
                          <form
                            action={`/workspaces/${context.workspace.slug}/keys/${key.id}/revoke`}
                            method="post"
                          >
                            <button className={styles.dangerButton} type="submit">
                              Revoke
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </WorkspaceShell>
  );
}
