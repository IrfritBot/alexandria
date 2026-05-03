import "server-only";

import {
  getMcpBearerToken,
  parseMcpApiKey,
  type McpApiKeyValidationResult,
  type McpBearerValidationResult,
} from "./api-keys";
import { createSupabaseServiceRoleClient } from "../supabase/service-role";

type SupabaseError = {
  code?: string;
  message?: string;
};

type RpcClient = {
  rpc(
    functionName: string,
    args?: Record<string, unknown>,
  ): Promise<{
    data: unknown;
    error: SupabaseError | null;
  }>;
};

function normalizeRpcRows(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null && !Array.isArray(row),
  );
}

export async function validateMcpApiKey(
  apiKey: string,
  rpcClient?: RpcClient,
): Promise<McpApiKeyValidationResult> {
  const parsedKey = parseMcpApiKey(apiKey);

  if (!parsedKey) {
    return { ok: false, reason: "malformed" };
  }

  try {
    const supabase =
      rpcClient ??
      ((createSupabaseServiceRoleClient() as unknown) as RpcClient);
    const { data, error } = await supabase.rpc("verify_mcp_api_key", {
      p_key_prefix: parsedKey.keyPrefix,
      p_presented_key: apiKey,
    });

    if (error) {
      return { ok: false, reason: "invalid" };
    }

    const [row] = normalizeRpcRows(data);

    if (typeof row?.id !== "string" || typeof row.workspace_id !== "string") {
      return { ok: false, reason: "invalid" };
    }

    return {
      ok: true,
      session: {
        keyPrefix: parsedKey.keyPrefix,
        mcpKeyId: row.id,
        workspaceId: row.workspace_id,
      },
    };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export async function validateMcpBearerToken(
  request: Request,
  rpcClient?: RpcClient,
): Promise<McpBearerValidationResult> {
  const bearerToken = getMcpBearerToken(request);

  if (!bearerToken.ok) {
    return bearerToken;
  }

  return validateMcpApiKey(bearerToken.token, rpcClient);
}
