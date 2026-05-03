import { formatCents, listUsageEvents } from "@/lib/web/governance";
import {
  isWorkspaceAdmin,
  requireWorkspaceContext,
} from "@/lib/web/workspace-context";

import {
  WorkspaceShell,
  workspaceStyles as styles,
} from "../_components/workspace-shell";

export const dynamic = "force-dynamic";

type UsagePageProps = {
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

export default async function UsagePage({ params }: UsagePageProps) {
  const { slug } = await params;
  const context = await requireWorkspaceContext({
    nextPath: `/workspaces/${slug}/usage`,
    slug,
  });
  const isAdmin = isWorkspaceAdmin(context);
  const result = isAdmin
    ? await listUsageEvents(
        {
          workspaceId: context.workspace.id,
        },
        context.supabase,
      )
    : null;

  return (
    <WorkspaceShell active="usage" context={context}>
      <section className={styles.section} aria-labelledby="usage-title">
        <h2 id="usage-title">Usage</h2>
        {!isAdmin ? (
          <div className={styles.adminOnly}>
            Usage events are available to workspace admins only.
          </div>
        ) : !result?.ok ? (
          <div className={styles.notice} role="alert">
            Unable to load usage events.
          </div>
        ) : (
          <>
            <div className={styles.grid}>
              <div className={styles.metric}>
                <span className={styles.muted}>Events</span>
                <strong>{result.summary.events}</strong>
              </div>
              <div className={styles.metric}>
                <span className={styles.muted}>LLM tokens</span>
                <strong>
                  {result.summary.llmInputTokens +
                    result.summary.llmOutputTokens}
                </strong>
              </div>
              <div className={styles.metric}>
                <span className={styles.muted}>Embedding tokens</span>
                <strong>{result.summary.embeddingTokens}</strong>
              </div>
              <div className={styles.metric}>
                <span className={styles.muted}>Estimated cost</span>
                <strong>{formatCents(result.summary.costEstimateCents)}</strong>
              </div>
            </div>

            {result.events.length === 0 ? (
              <div className={styles.notice}>No usage events found.</div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Event</th>
                      <th>Tier</th>
                      <th>Model</th>
                      <th>LLM tokens</th>
                      <th>Embedding tokens</th>
                      <th>Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.events.map((event) => (
                      <tr key={event.id}>
                        <td>{formatDate(event.occurredAt)}</td>
                        <td>{event.eventType}</td>
                        <td>{event.processingTier}</td>
                        <td>{event.llmModel ?? "Not recorded"}</td>
                        <td>
                          {event.llmInputTokens + event.llmOutputTokens}
                        </td>
                        <td>{event.embeddingTokens}</td>
                        <td>{formatCents(event.costEstimateCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </WorkspaceShell>
  );
}
