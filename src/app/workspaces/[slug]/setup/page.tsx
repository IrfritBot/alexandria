import {
  CLIENT_SETUP_POLICIES,
  mcpConnectionDetails,
} from "@/lib/mcp/client-setup-policy";
import { requireWorkspaceContext } from "@/lib/web/workspace-context";

import {
  WorkspaceShell,
  workspaceStyles as styles,
} from "../_components/workspace-shell";

export const dynamic = "force-dynamic";

type SetupPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function WorkspaceSetupPage({ params }: SetupPageProps) {
  const { slug } = await params;
  const context = await requireWorkspaceContext({
    nextPath: `/workspaces/${slug}/setup`,
    slug,
  });
  const connection = mcpConnectionDetails();

  return (
    <WorkspaceShell active="setup" context={context}>
      <section className={styles.section} aria-labelledby="setup-title">
        <h2 id="setup-title">Client setup</h2>
        <p className={styles.muted}>
          Connect an OAuth-capable MCP client to Alexandria, then add the
          matching policy block to the client workspace instructions.
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <tbody>
              <tr>
                <th scope="row">Remote MCP URL</th>
                <td>{connection.mcpServerUrl}</td>
              </tr>
              <tr>
                <th scope="row">Protected resource metadata</th>
                <td>{connection.protectedResourceMetadataUrl}</td>
              </tr>
              <tr>
                <th scope="row">Authorization server metadata</th>
                <td>{connection.authorizationServerMetadataUrl}</td>
              </tr>
              <tr>
                <th scope="row">OAuth scopes</th>
                <td>{connection.scopes.join(" ")}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="policy-title">
        <h2 id="policy-title">Client policies</h2>
        <ul className={styles.list}>
          {CLIENT_SETUP_POLICIES.map((policy) => (
            <li className={styles.item} key={policy.id}>
              <div className={styles.itemHeader}>
                <div>
                  <p className={styles.itemTitle}>{policy.clientName}</p>
                  <p className={styles.muted}>{policy.placement}</p>
                </div>
              </div>
              <pre className={styles.pre}>{policy.body}</pre>
            </li>
          ))}
        </ul>
      </section>
    </WorkspaceShell>
  );
}
