import Link from "next/link";

import type { WebWorkspaceContext } from "@/lib/web/workspace-context";

import styles from "./workspace-shell.module.css";

type WorkspaceShellProps = {
  active:
    | "audit"
    | "conflicts"
    | "dashboard"
    | "keys"
    | "memories"
    | "setup"
    | "usage";
  children: React.ReactNode;
  context: WebWorkspaceContext;
};

const NAV_ITEMS: Array<{
  adminOnly?: boolean;
  id: WorkspaceShellProps["active"];
  label: string;
  path: string;
}> = [
  { id: "dashboard", label: "Dashboard", path: "" },
  { id: "memories", label: "Memories", path: "/memories" },
  { id: "setup", label: "Setup", path: "/setup" },
  { adminOnly: true, id: "keys", label: "MCP keys", path: "/keys" },
  { adminOnly: true, id: "conflicts", label: "Conflicts", path: "/conflicts" },
  { adminOnly: true, id: "audit", label: "Audit", path: "/audit" },
  { adminOnly: true, id: "usage", label: "Usage", path: "/usage" },
];

function workspacePath(slug: string, path: string) {
  return `/workspaces/${slug}${path}`;
}

export function WorkspaceShell({
  active,
  children,
  context,
}: WorkspaceShellProps) {
  const isAdmin = context.membership.role === "admin";

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.topline}>
            <div>
              <p className={styles.eyebrow}>Alexandria workspace</p>
              <h1 className={styles.title}>{context.workspace.name}</h1>
              <p className={styles.meta}>
                {context.user.email ?? "Signed-in user"} · {context.workspace.tier}
              </p>
            </div>
            <span className={styles.role}>
              {isAdmin ? "Admin" : "Member"}
            </span>
          </div>
          <nav className={styles.nav} aria-label="Workspace navigation">
            {NAV_ITEMS.map((item) => (
              <Link
                aria-current={active === item.id ? "page" : undefined}
                href={workspacePath(context.workspace.slug, item.path)}
                key={item.id}
              >
                {item.label}
                {item.adminOnly && !isAdmin ? (
                  <span className={styles.adminHint}>Admin</span>
                ) : null}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className={styles.content}>{children}</main>
    </div>
  );
}

export { styles as workspaceStyles };
