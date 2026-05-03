import "server-only";

import type { ValidMcpSession } from "./api-keys";

type SupabaseError = {
  message?: string;
};

export type McpTransactionClient = {
  rpc(
    functionName: "set_mcp_session",
    args: {
      p_workspace_id: string;
      p_mcp_key_id: string;
    },
  ): Promise<{ error: SupabaseError | null }>;
};

export type McpTransactionRunner = {
  transaction<T>(
    work: (transactionClient: McpTransactionClient) => Promise<T>,
  ): Promise<T>;
};

export class McpSessionBindingError extends Error {
  constructor(message = "Unable to bind MCP session.") {
    super(message);
    this.name = "McpSessionBindingError";
  }
}

export async function withMcpSessionTransaction<T>(
  runner: McpTransactionRunner,
  session: Pick<ValidMcpSession, "workspaceId" | "mcpKeyId">,
  work: (transactionClient: McpTransactionClient) => Promise<T>,
): Promise<T> {
  return runner.transaction(async (transactionClient) => {
    const { error } = await transactionClient.rpc("set_mcp_session", {
      p_mcp_key_id: session.mcpKeyId,
      p_workspace_id: session.workspaceId,
    });

    if (error) {
      throw new McpSessionBindingError(error.message);
    }

    return work(transactionClient);
  });
}
