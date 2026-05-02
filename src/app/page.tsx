import Link from "next/link";

import { createSupabaseServerClient } from "../lib/supabase/server";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type WorkspaceMembership = {
  workspaces: {
    name: string;
    slug: string;
  } | null;
};

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className={styles.home}>
        <section aria-labelledby="page-title">
          <p className={styles.eyebrow}>Alexandria</p>
          <h1 id="page-title">Shared team memory</h1>
          <p>
            Alexandria keeps important team context, decisions, and policies in
            one searchable workspace.
          </p>
          <Link href="/login">Sign in</Link>
        </section>
      </main>
    );
  }

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspaces(name, slug)")
    .order("joined_at", { ascending: true })
    .overrideTypes<WorkspaceMembership[], { merge: false }>();
  const workspaces = (memberships ?? [])
    .map((membership) => membership.workspaces)
    .filter((workspace): workspace is NonNullable<typeof workspace> =>
      Boolean(workspace),
    );

  return (
    <main className={styles.home}>
      <section aria-labelledby="page-title">
        <p className={styles.eyebrow}>Alexandria</p>
        <h1 id="page-title">Welcome</h1>
        <p>{user.email}</p>
        <Link href="/workspaces/new">Create workspace</Link>
        {workspaces.length > 0 ? (
          <ul aria-label="Your workspaces">
            {workspaces.map((workspace) => (
              <li key={workspace.slug}>
                {workspace.name} ({workspace.slug})
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
