import "server-only";

import { randomBytes } from "node:crypto";

import { createSupabaseServerClient } from "../supabase/server";

const MCP_API_KEY_PATTERN = /^alex_([a-f0-9]{8})_[a-f0-9]{32}$/;
const MAX_ISSUE_ATTEMPTS = 3;

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

type ListMcpKeysClient = {
  from(tableName: "mcp_keys"): {
    select(columns: string): {
      eq(
        column: "workspace_id",
        value: string,
      ): {
        order(
          column: "created_at",
          options: { ascending: boolean },
        ): Promise<{
          data: unknown;
          error: SupabaseError | null;
        }>;
      };
    };
  };
};

export type McpKeySafeRecord = {
  id: string;
  workspaceId: string;
  name: string;
  keyPrefix: string;
  createdByProfileId: string | null;
  revokedByProfileId: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type IssuedMcpKey = {
  id: string;
  workspaceId: string;
  name: string;
  keyPrefix: string;
  apiKey: string;
  createdAt: string;
};

export type IssueMcpKeyResult =
  | { ok: true; key: IssuedMcpKey }
  | {
      ok: false;
      reason:
        | "invalid_input"
        | "unauthenticated"
        | "missing_profile"
        | "forbidden"
        | "key_prefix_taken"
        | "issue_failed";
      field?: "workspaceId" | "name";
    };

export type ListMcpKeysResult =
  | { ok: true; keys: McpKeySafeRecord[] }
  | { ok: false; reason: "invalid_input" | "list_failed"; field?: "workspaceId" };

export type RevokeMcpKeyResult =
  | { ok: true; key: Pick<McpKeySafeRecord, "id" | "workspaceId" | "name" | "keyPrefix" | "revokedAt"> }
  | {
      ok: false;
      reason:
        | "invalid_input"
        | "unauthenticated"
        | "missing_profile"
        | "forbidden"
        | "not_found"
        | "revoke_failed";
      field?: "workspaceId" | "mcpKeyId";
    };

export type ValidMcpSession = {
  workspaceId: string;
  mcpKeyId: string;
  keyPrefix: string;
};

export type McpApiKeyValidationResult =
  | { ok: true; session: ValidMcpSession }
  | { ok: false; reason: "malformed" | "invalid" };

export type McpBearerValidationResult =
  | { ok: true; session: ValidMcpSession }
  | { ok: false; reason: "missing" | "malformed" | "invalid" };

function randomHex(byteLength: number) {
  return randomBytes(byteLength).toString("hex");
}

function isNonEmpty(value: string) {
  return value.trim().length > 0;
}

function normalizeRpcRows(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null && !Array.isArray(row),
  );
}

function mapIssueError(error: SupabaseError): Exclude<IssueMcpKeyResult, { ok: true }> {
  if (error.code === "28000") {
    return { ok: false, reason: "unauthenticated" };
  }

  if (error.message?.includes("missing_profile")) {
    return { ok: false, reason: "missing_profile" };
  }

  if (error.code === "42501") {
    return { ok: false, reason: "forbidden" };
  }

  if (error.code === "23505") {
    return { ok: false, reason: "key_prefix_taken" };
  }

  if (error.code === "22023") {
    if (error.message?.includes("invalid_input:name")) {
      return { ok: false, reason: "invalid_input", field: "name" };
    }

    if (error.message?.includes("invalid_input:workspaceId")) {
      return { ok: false, reason: "invalid_input", field: "workspaceId" };
    }
  }

  return { ok: false, reason: "issue_failed" };
}

function mapRevokeError(error: SupabaseError): Exclude<RevokeMcpKeyResult, { ok: true }> {
  if (error.code === "28000") {
    return { ok: false, reason: "unauthenticated" };
  }

  if (error.message?.includes("missing_profile")) {
    return { ok: false, reason: "missing_profile" };
  }

  if (error.code === "42501") {
    return { ok: false, reason: "forbidden" };
  }

  if (error.code === "P0002" || error.message?.includes("mcp_key_not_found")) {
    return { ok: false, reason: "not_found" };
  }

  if (error.code === "22023") {
    return { ok: false, reason: "invalid_input" };
  }

  return { ok: false, reason: "revoke_failed" };
}

export function generateMcpApiKey() {
  return `alex_${randomHex(4)}_${randomHex(16)}`;
}

export function parseMcpApiKey(apiKey: string): { keyPrefix: string } | null {
  const match = MCP_API_KEY_PATTERN.exec(apiKey);

  if (!match) {
    return null;
  }

  return { keyPrefix: match[1] };
}

export function getMcpBearerToken(request: Request) {
  const header = request.headers.get("authorization");

  if (!header) {
    return { ok: false as const, reason: "missing" as const };
  }

  const [scheme, token, extra] = header.trim().split(/\s+/);

  if (extra || scheme?.toLowerCase() !== "bearer" || !token) {
    return { ok: false as const, reason: "malformed" as const };
  }

  return { ok: true as const, token };
}

export async function issueMcpKey(
  input: { workspaceId: string; name: string },
  rpcClient?: RpcClient,
): Promise<IssueMcpKeyResult> {
  if (!isNonEmpty(input.workspaceId)) {
    return { ok: false, reason: "invalid_input", field: "workspaceId" };
  }

  if (!isNonEmpty(input.name)) {
    return { ok: false, reason: "invalid_input", field: "name" };
  }

  const supabase =
    rpcClient ?? ((await createSupabaseServerClient()) as unknown as RpcClient);
  let lastPrefixError: Exclude<IssueMcpKeyResult, { ok: true }> | null = null;

  for (let attempt = 0; attempt < MAX_ISSUE_ATTEMPTS; attempt += 1) {
    const apiKey = generateMcpApiKey();
    const parsedKey = parseMcpApiKey(apiKey);

    if (!parsedKey) {
      return { ok: false, reason: "issue_failed" };
    }

    const { data, error } = await supabase.rpc("issue_mcp_key", {
      p_key_prefix: parsedKey.keyPrefix,
      p_name: input.name.trim(),
      p_presented_key: apiKey,
      p_workspace_id: input.workspaceId.trim(),
    });

    if (error) {
      const mappedError = mapIssueError(error);

      if (mappedError.reason === "key_prefix_taken") {
        lastPrefixError = mappedError;
        continue;
      }

      return mappedError;
    }

    const [row] = normalizeRpcRows(data);

    if (
      typeof row?.id !== "string" ||
      typeof row.workspace_id !== "string" ||
      typeof row.name !== "string" ||
      typeof row.key_prefix !== "string" ||
      typeof row.created_at !== "string"
    ) {
      return { ok: false, reason: "issue_failed" };
    }

    return {
      ok: true,
      key: {
        apiKey,
        createdAt: row.created_at,
        id: row.id,
        keyPrefix: row.key_prefix,
        name: row.name,
        workspaceId: row.workspace_id,
      },
    };
  }

  return lastPrefixError ?? { ok: false, reason: "issue_failed" };
}

export async function listMcpKeys(
  input: { workspaceId: string },
  queryClient?: ListMcpKeysClient,
): Promise<ListMcpKeysResult> {
  if (!isNonEmpty(input.workspaceId)) {
    return { ok: false, reason: "invalid_input", field: "workspaceId" };
  }

  const supabase =
    queryClient ??
    ((await createSupabaseServerClient()) as unknown as ListMcpKeysClient);
  const { data, error } = await supabase
    .from("mcp_keys")
    .select(
      "id, workspace_id, name, key_prefix, created_by_profile_id, revoked_by_profile_id, created_at, last_used_at, revoked_at",
    )
    .eq("workspace_id", input.workspaceId.trim())
    .order("created_at", { ascending: false });

  if (error) {
    return { ok: false, reason: "list_failed" };
  }

  const keys = normalizeRpcRows(data).flatMap((row) => {
    if (
      typeof row.id !== "string" ||
      typeof row.workspace_id !== "string" ||
      typeof row.name !== "string" ||
      typeof row.key_prefix !== "string" ||
      typeof row.created_at !== "string"
    ) {
      return [];
    }

    return [
      {
        createdAt: row.created_at,
        createdByProfileId:
          typeof row.created_by_profile_id === "string"
            ? row.created_by_profile_id
            : null,
        id: row.id,
        keyPrefix: row.key_prefix,
        lastUsedAt:
          typeof row.last_used_at === "string" ? row.last_used_at : null,
        name: row.name,
        revokedAt:
          typeof row.revoked_at === "string" ? row.revoked_at : null,
        revokedByProfileId:
          typeof row.revoked_by_profile_id === "string"
            ? row.revoked_by_profile_id
            : null,
        workspaceId: row.workspace_id,
      },
    ];
  });

  return { ok: true, keys };
}

export async function revokeMcpKey(
  input: { workspaceId: string; mcpKeyId: string },
  rpcClient?: RpcClient,
): Promise<RevokeMcpKeyResult> {
  if (!isNonEmpty(input.workspaceId)) {
    return { ok: false, reason: "invalid_input", field: "workspaceId" };
  }

  if (!isNonEmpty(input.mcpKeyId)) {
    return { ok: false, reason: "invalid_input", field: "mcpKeyId" };
  }

  const supabase =
    rpcClient ?? ((await createSupabaseServerClient()) as unknown as RpcClient);
  const { data, error } = await supabase.rpc("revoke_mcp_key", {
    p_mcp_key_id: input.mcpKeyId.trim(),
    p_workspace_id: input.workspaceId.trim(),
  });

  if (error) {
    return mapRevokeError(error);
  }

  const [row] = normalizeRpcRows(data);

  if (
    typeof row?.id !== "string" ||
    typeof row.workspace_id !== "string" ||
    typeof row.name !== "string" ||
    typeof row.key_prefix !== "string"
  ) {
    return { ok: false, reason: "revoke_failed" };
  }

  return {
    ok: true,
    key: {
      id: row.id,
      keyPrefix: row.key_prefix,
      name: row.name,
      revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
      workspaceId: row.workspace_id,
    },
  };
}
