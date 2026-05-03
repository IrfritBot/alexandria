import Link from "next/link";
import { notFound } from "next/navigation";

import { snippet } from "@/lib/web/governance";
import { getWebMemory } from "@/lib/web/memories";
import { requireWorkspaceContext } from "@/lib/web/workspace-context";

import {
  WorkspaceShell,
  workspaceStyles as styles,
} from "../../_components/workspace-shell";

export const dynamic = "force-dynamic";

type MemoryDetailPageProps = {
  params: Promise<{
    memoryId: string;
    slug: string;
  }>;
};

function formatDate(value: string | null) {
  if (!value) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function MemoryDetailPage({
  params,
}: MemoryDetailPageProps) {
  const { memoryId, slug } = await params;
  const context = await requireWorkspaceContext({
    nextPath: `/workspaces/${slug}/memories/${memoryId}`,
    slug,
  });
  const result = await getWebMemory(
    {
      memoryId,
      workspaceId: context.workspace.id,
    },
    context.supabase,
  );

  if (!result.ok) {
    if (result.reason === "not_found") {
      notFound();
    }

    throw new Error("Unable to load memory.");
  }

  const { memory, revisions } = result;

  return (
    <WorkspaceShell active="memories" context={context}>
      <section className={styles.section} aria-labelledby="memory-title">
        <Link
          className={styles.secondaryButton}
          href={`/workspaces/${context.workspace.slug}/memories`}
        >
          Back to memories
        </Link>
        <h2 id="memory-title">{memory.title ?? snippet(memory.content, 90)}</h2>
        <div className={styles.badges}>
          <span className={styles.badge}>{memory.kind}</span>
          <span className={styles.badge}>{memory.status}</span>
          <span className={styles.badge}>{memory.source}</span>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="content-title">
        <h2 id="content-title">Content</h2>
        <p>{memory.content}</p>
        {memory.tags.length > 0 ? (
          <div className={styles.badges} aria-label="Tags">
            {memory.tags.map((tag) => (
              <span className={styles.badge} key={tag}>
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <section className={styles.section} aria-labelledby="details-title">
        <h2 id="details-title">Details</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <tbody>
              <tr>
                <th scope="row">Memory ID</th>
                <td>{memory.id}</td>
              </tr>
              <tr>
                <th scope="row">Author</th>
                <td>{memory.authorLabel}</td>
              </tr>
              <tr>
                <th scope="row">Source client</th>
                <td>{memory.sourceClient ?? "Not recorded"}</td>
              </tr>
              <tr>
                <th scope="row">Created</th>
                <td>{formatDate(memory.createdAt)}</td>
              </tr>
              <tr>
                <th scope="row">Updated</th>
                <td>{formatDate(memory.updatedAt)}</td>
              </tr>
              <tr>
                <th scope="row">Processed</th>
                <td>{formatDate(memory.processedAt)}</td>
              </tr>
              <tr>
                <th scope="row">Superseded by</th>
                <td>{memory.supersededByMemoryId ?? "No"}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="revisions-title">
        <h2 id="revisions-title">Recent revisions</h2>
        {revisions.length === 0 ? (
          <div className={styles.notice}>No revisions found.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Revision</th>
                  <th>Kind</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {revisions.map((revision) => (
                  <tr key={revision.id}>
                    <td>{revision.revisionNumber}</td>
                    <td>{revision.kind}</td>
                    <td>{revision.status}</td>
                    <td>{formatDate(revision.createdAt)}</td>
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
