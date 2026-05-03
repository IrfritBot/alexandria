import Link from "next/link";

import {
  listWebMemories,
  normalizeMemoryKindFilter,
} from "@/lib/web/memories";
import { requireWorkspaceContext } from "@/lib/web/workspace-context";

import {
  WorkspaceShell,
  workspaceStyles as styles,
} from "../_components/workspace-shell";

export const dynamic = "force-dynamic";

type MemoriesPageProps = {
  params: Promise<{
    slug: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function MemoriesPage({
  params,
  searchParams,
}: MemoriesPageProps) {
  const { slug } = await params;
  const queryParams = (await searchParams) ?? {};
  const query = firstParam(queryParams.q)?.trim() ?? "";
  const kind = normalizeMemoryKindFilter(firstParam(queryParams.kind));
  const context = await requireWorkspaceContext({
    nextPath: `/workspaces/${slug}/memories`,
    slug,
  });
  const result = await listWebMemories(
    {
      kind,
      query,
      workspaceId: context.workspace.id,
    },
    context.supabase,
  );

  return (
    <WorkspaceShell active="memories" context={context}>
      <section className={styles.section} aria-labelledby="memories-title">
        <h2 id="memories-title">Memories</h2>
        <form className={styles.toolbar} method="get">
          <div className={styles.field}>
            <label htmlFor="q">Search</label>
            <input
              className={styles.input}
              defaultValue={query}
              id="q"
              name="q"
              placeholder="Decision, policy, or fact"
              type="search"
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="kind">Kind</label>
            <select
              className={styles.select}
              defaultValue={kind ?? ""}
              id="kind"
              name="kind"
            >
              <option value="">All</option>
              <option value="policy">Policy</option>
              <option value="fact">Fact</option>
              <option value="judgment">Judgment</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>
          <button className={styles.button} type="submit">
            Search
          </button>
        </form>
      </section>

      <section className={styles.section} aria-label="Memory results">
        {!result.ok ? (
          <div className={styles.notice} role="alert">
            Unable to load memories.
          </div>
        ) : result.memories.length === 0 ? (
          <div className={styles.notice}>No memories found.</div>
        ) : (
          <ul className={styles.list}>
            {result.memories.map((memory) => (
              <li className={styles.item} key={memory.id}>
                <div className={styles.itemHeader}>
                  <div>
                    <p className={styles.itemTitle}>
                      <Link
                        href={`/workspaces/${context.workspace.slug}/memories/${memory.id}`}
                      >
                        {memory.title ?? memory.content.slice(0, 80)}
                      </Link>
                    </p>
                    <p className={styles.muted}>
                      {memory.authorLabel} · {formatDate(memory.updatedAt)}
                    </p>
                  </div>
                  <div className={styles.badges}>
                    <span className={styles.badge}>{memory.kind}</span>
                    <span className={styles.badge}>{memory.status}</span>
                  </div>
                </div>
                <p>{memory.content.slice(0, 240)}</p>
                {memory.tags.length > 0 ? (
                  <div className={styles.badges} aria-label="Tags">
                    {memory.tags.map((tag) => (
                      <span className={styles.badge} key={tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </WorkspaceShell>
  );
}
