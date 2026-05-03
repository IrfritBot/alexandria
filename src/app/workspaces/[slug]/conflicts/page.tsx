import Link from "next/link";

import {
  listUnresolvedConflicts,
  snippet,
  titleOrId,
} from "@/lib/web/governance";
import {
  isWorkspaceAdmin,
  requireWorkspaceContext,
} from "@/lib/web/workspace-context";

import {
  WorkspaceShell,
  workspaceStyles as styles,
} from "../_components/workspace-shell";

export const dynamic = "force-dynamic";

type ConflictsPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

function memoryHref(slug: string, memoryId: string) {
  return `/workspaces/${slug}/memories/${memoryId}`;
}

export default async function ConflictsPage({ params }: ConflictsPageProps) {
  const { slug } = await params;
  const context = await requireWorkspaceContext({
    nextPath: `/workspaces/${slug}/conflicts`,
    slug,
  });
  const isAdmin = isWorkspaceAdmin(context);
  const result = isAdmin
    ? await listUnresolvedConflicts(
        {
          workspaceId: context.workspace.id,
        },
        context.supabase,
      )
    : null;

  return (
    <WorkspaceShell active="conflicts" context={context}>
      <section className={styles.section} aria-labelledby="conflicts-title">
        <h2 id="conflicts-title">Unresolved conflicts</h2>
        {!isAdmin ? (
          <div className={styles.adminOnly}>
            Conflict review is available to workspace admins only.
          </div>
        ) : !result?.ok ? (
          <div className={styles.notice} role="alert">
            Unable to load conflicts.
          </div>
        ) : result.conflicts.length === 0 ? (
          <div className={styles.notice}>No unresolved conflicts.</div>
        ) : (
          <ul className={styles.list}>
            {result.conflicts.map((conflict) => (
              <li className={styles.item} key={conflict.id}>
                <div className={styles.itemHeader}>
                  <p className={styles.itemTitle}>Conflict {conflict.id}</p>
                  <span className={styles.badge}>unresolved</span>
                </div>
                <div className={styles.comparisonGrid}>
                  {[conflict.sourceMemory, conflict.targetMemory].map(
                    (memory, index) => (
                      <div className={styles.comparisonPane} key={index}>
                        {memory ? (
                          <>
                            <p className={styles.itemTitle}>
                              <Link href={memoryHref(slug, memory.id)}>
                                {titleOrId(memory.title, memory.id)}
                              </Link>
                            </p>
                            <p className={styles.muted}>
                              {memory.kind} · {memory.status}
                            </p>
                            <p>{snippet(memory.content)}</p>
                          </>
                        ) : (
                          <p className={styles.muted}>Memory not available.</p>
                        )}
                      </div>
                    ),
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </WorkspaceShell>
  );
}
