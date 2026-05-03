import { listAuditEvents } from "@/lib/web/governance";
import {
  isWorkspaceAdmin,
  requireWorkspaceContext,
} from "@/lib/web/workspace-context";

import {
  WorkspaceShell,
  workspaceStyles as styles,
} from "../_components/workspace-shell";

export const dynamic = "force-dynamic";

type AuditPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function AuditPage({ params }: AuditPageProps) {
  const { slug } = await params;
  const context = await requireWorkspaceContext({
    nextPath: `/workspaces/${slug}/audit`,
    slug,
  });
  const isAdmin = isWorkspaceAdmin(context);
  const result = isAdmin
    ? await listAuditEvents(
        {
          workspaceId: context.workspace.id,
        },
        context.supabase,
      )
    : null;

  return (
    <WorkspaceShell active="audit" context={context}>
      <section className={styles.section} aria-labelledby="audit-title">
        <h2 id="audit-title">Audit</h2>
        {!isAdmin ? (
          <div className={styles.adminOnly}>
            Audit logs are available to workspace admins only.
          </div>
        ) : !result?.ok ? (
          <div className={styles.notice} role="alert">
            Unable to load audit events.
          </div>
        ) : result.events.length === 0 ? (
          <div className={styles.notice}>No audit events found.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Scope</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Target</th>
                </tr>
              </thead>
              <tbody>
                {result.events.map((event) => (
                  <tr key={`${event.type}-${event.id}`}>
                    <td>{formatDate(event.createdAt)}</td>
                    <td>{event.type}</td>
                    <td>{event.action}</td>
                    <td>{event.actorLabel ?? event.actorType}</td>
                    <td>{event.targetId ?? "Not recorded"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </WorkspaceShell>
  );
}
