import Link from "next/link";

import { getDashboardSummary } from "@/lib/web/governance";
import {
  isWorkspaceAdmin,
  requireWorkspaceContext,
} from "@/lib/web/workspace-context";

import {
  WorkspaceShell,
  workspaceStyles as styles,
} from "./_components/workspace-shell";

export const dynamic = "force-dynamic";

type WorkspacePageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function WorkspaceDashboardPage({
  params,
}: WorkspacePageProps) {
  const { slug } = await params;
  const context = await requireWorkspaceContext({
    nextPath: `/workspaces/${slug}`,
    slug,
  });
  const isAdmin = isWorkspaceAdmin(context);
  const summary = await getDashboardSummary(
    {
      isAdmin,
      workspaceId: context.workspace.id,
    },
    context.supabase,
  );

  return (
    <WorkspaceShell active="dashboard" context={context}>
      <section className={styles.section} aria-labelledby="dashboard-title">
        <h2 id="dashboard-title">Dashboard</h2>
        <p className={styles.muted}>{context.workspace.contextDescription}</p>
        <div className={styles.grid}>
          <div className={styles.metric}>
            <span className={styles.muted}>Active memories</span>
            <strong>{summary.activeMemories}</strong>
          </div>
          <div className={styles.metric}>
            <span className={styles.muted}>Unresolved conflicts</span>
            <strong>{isAdmin ? summary.unresolvedConflicts ?? "?" : "Admin"}</strong>
          </div>
          <div className={styles.metric}>
            <span className={styles.muted}>Active MCP keys</span>
            <strong>{isAdmin ? summary.mcpKeys ?? "?" : "Admin"}</strong>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="quick-links-title">
        <h2 id="quick-links-title">Workspace</h2>
        <div className={styles.toolbar}>
          <Link
            className={styles.secondaryButton}
            href={`/workspaces/${context.workspace.slug}/memories`}
          >
            Browse memories
          </Link>
          <Link
            className={styles.secondaryButton}
            href={`/workspaces/${context.workspace.slug}/setup`}
          >
            Set up clients
          </Link>
          <Link
            className={styles.secondaryButton}
            href={`/workspaces/${context.workspace.slug}/keys`}
          >
            Manage MCP keys
          </Link>
          <Link
            className={styles.secondaryButton}
            href={`/workspaces/${context.workspace.slug}/conflicts`}
          >
            Review conflicts
          </Link>
        </div>
        {!isAdmin ? (
          <p className={styles.muted}>
            Members can browse workspace memory and set up clients. MCP keys,
            conflicts, audit, and usage are admin-only.
          </p>
        ) : null}
      </section>
    </WorkspaceShell>
  );
}
