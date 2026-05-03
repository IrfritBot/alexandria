import "server-only";

import type { ValidMcpSession } from "./api-keys";
import { normalizeMcpTag } from "./memory-save";
import { createSupabaseMcpExecutorClient } from "../supabase/mcp-executor";

const MAX_SEARCH_LIMIT = 50;
const MAX_RECALL_LIMIT = 100;
const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_RECALL_LIMIT = 20;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export type MemoryReadField =
  | "author_profile_id"
  | "kind"
  | "limit"
  | "memory_id"
  | "query"
  | "since"
  | "tags";

export type MemorySource = "mcp" | "web_ui" | "import";
export type SearchMemoryKind = "policy" | "fact" | "judgment";

export type McpMemorySearchItem = {
  author_label: string;
  content: string;
  created_at: string;
  kind: string;
  memory_id: string;
  relevance_score: number;
  source: MemorySource;
  source_client: string | null;
  tags: string[];
};

export type McpMemoryRecentItem = Omit<
  McpMemorySearchItem,
  "relevance_score"
>;

export type McpMemoryGetItem = McpMemoryRecentItem & {
  superseded_by_memory_id: string | null;
  updated_at: string;
};

export type MemorySearchResult =
  | {
      ok: true;
      memories: McpMemorySearchItem[];
      total: number;
    }
  | MemoryReadFailure;

export type MemoryRecallRecentResult =
  | {
      ok: true;
      memories: McpMemoryRecentItem[];
    }
  | MemoryReadFailure;

export type MemoryGetResult =
  | {
      ok: true;
      memory: McpMemoryGetItem;
    }
  | MemoryReadFailure
  | {
      ok: false;
      reason: "not_found";
    };

type MemoryReadFailure = {
  field?: MemoryReadField;
  ok: false;
  reason: "invalid_input" | "invalid_mcp_session" | "read_failed";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function normalizeLimit(
  value: unknown,
  defaultLimit: number,
  maxLimit: number,
): { ok: true; limit: number } | { ok: false } {
  if (value === undefined) {
    return { ok: true, limit: defaultLimit };
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return { ok: false };
  }

  return { ok: true, limit: Math.min(value, maxLimit) };
}

function normalizeTags(
  value: unknown,
): { ok: true; tags: string[] } | { ok: false } {
  if (value === undefined) {
    return { ok: true, tags: [] };
  }

  if (
    !Array.isArray(value) ||
    !value.every((tag): tag is string => typeof tag === "string")
  ) {
    return { ok: false };
  }

  const seenTags = new Set<string>();
  const tags = value.flatMap((tag) => {
    const normalizedTag = normalizeMcpTag(tag);

    if (!normalizedTag || seenTags.has(normalizedTag)) {
      return [];
    }

    seenTags.add(normalizedTag);
    return [normalizedTag];
  });

  return { ok: true, tags };
}

function isKind(value: unknown): value is SearchMemoryKind {
  return value === "policy" || value === "fact" || value === "judgment";
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function normalizeIsoDate(value: string) {
  const time = Date.parse(value);

  if (!Number.isFinite(time)) {
    return null;
  }

  return new Date(time).toISOString();
}

function normalizeSource(value: unknown): MemorySource {
  if (value === "web_ui" || value === "import") {
    return value;
  }

  return "mcp";
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function normalizeScore(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function normalizeTotal(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : fallback;
}

function mapReadError(
  error: SupabaseError,
  fallbackReason: "read_failed",
): MemoryReadFailure {
  if (error.code === "42501") {
    return { ok: false, reason: "invalid_mcp_session" };
  }

  if (error.code === "22023") {
    if (error.message?.includes("invalid_input:kind")) {
      return { ok: false, reason: "invalid_input", field: "kind" };
    }

    if (error.message?.includes("invalid_input:limit")) {
      return { ok: false, reason: "invalid_input", field: "limit" };
    }

    if (error.message?.includes("invalid_input:memory_id")) {
      return { ok: false, reason: "invalid_input", field: "memory_id" };
    }

    if (error.message?.includes("invalid_input:since")) {
      return { ok: false, reason: "invalid_input", field: "since" };
    }

    if (error.message?.includes("invalid_input:tags")) {
      return { ok: false, reason: "invalid_input", field: "tags" };
    }

    return { ok: false, reason: "invalid_input", field: "query" };
  }

  return { ok: false, reason: fallbackReason };
}

function mapSearchRow(row: Record<string, unknown>): McpMemorySearchItem | null {
  if (
    typeof row.memory_id !== "string" ||
    typeof row.content !== "string" ||
    typeof row.kind !== "string" ||
    typeof row.author_label !== "string" ||
    typeof row.created_at !== "string"
  ) {
    return null;
  }

  return {
    author_label: row.author_label,
    content: row.content,
    created_at: row.created_at,
    kind: row.kind,
    memory_id: row.memory_id,
    relevance_score: normalizeScore(row.relevance_score),
    source: normalizeSource(row.source),
    source_client:
      typeof row.source_client === "string" ? row.source_client : null,
    tags: normalizeStringArray(row.tags),
  };
}

function mapRecentRow(row: Record<string, unknown>): McpMemoryRecentItem | null {
  const searchItem = mapSearchRow({
    ...row,
    relevance_score: 0,
  });

  if (!searchItem) {
    return null;
  }

  return {
    author_label: searchItem.author_label,
    content: searchItem.content,
    created_at: searchItem.created_at,
    kind: searchItem.kind,
    memory_id: searchItem.memory_id,
    source: searchItem.source,
    source_client: searchItem.source_client,
    tags: searchItem.tags,
  };
}

function mapGetRow(row: Record<string, unknown>): McpMemoryGetItem | null {
  const recentItem = mapRecentRow(row);

  if (
    !recentItem ||
    typeof row.updated_at !== "string" ||
    (row.superseded_by_memory_id !== null &&
      row.superseded_by_memory_id !== undefined &&
      typeof row.superseded_by_memory_id !== "string")
  ) {
    return null;
  }

  return {
    ...recentItem,
    superseded_by_memory_id:
      typeof row.superseded_by_memory_id === "string"
        ? row.superseded_by_memory_id
        : null,
    updated_at: row.updated_at,
  };
}

function getRpcClient(dependencies?: { rpcClient?: RpcClient }) {
  return (
    dependencies?.rpcClient ??
    ((createSupabaseMcpExecutorClient() as unknown) as RpcClient)
  );
}

export function validateMemorySearchPayload(
  payload: unknown,
):
  | {
      ok: true;
      kind: SearchMemoryKind | null;
      limit: number;
      query: string;
      tags: string[];
    }
  | {
      ok: false;
      field: MemoryReadField;
    } {
  if (!isRecord(payload) || typeof payload.query !== "string") {
    return { ok: false, field: "query" };
  }

  const query = payload.query.trim();

  if (query.length === 0) {
    return { ok: false, field: "query" };
  }

  const limit = normalizeLimit(
    payload.limit,
    DEFAULT_SEARCH_LIMIT,
    MAX_SEARCH_LIMIT,
  );

  if (!limit.ok) {
    return { ok: false, field: "limit" };
  }

  const tags = normalizeTags(payload.tags);

  if (!tags.ok) {
    return { ok: false, field: "tags" };
  }

  if (payload.kind !== undefined && !isKind(payload.kind)) {
    return { ok: false, field: "kind" };
  }

  return {
    kind: payload.kind ?? null,
    limit: limit.limit,
    ok: true,
    query,
    tags: tags.tags,
  };
}

export function validateMemoryRecallRecentPayload(
  payload: unknown,
):
  | {
      ok: true;
      authorProfileId: string | null;
      limit: number;
      since: string | null;
    }
  | {
      ok: false;
      field: MemoryReadField;
    } {
  const input = isRecord(payload) ? payload : {};
  const limit = normalizeLimit(
    input.limit,
    DEFAULT_RECALL_LIMIT,
    MAX_RECALL_LIMIT,
  );

  if (!limit.ok) {
    return { ok: false, field: "limit" };
  }

  let since: string | null = null;

  if (input.since !== undefined) {
    if (typeof input.since !== "string") {
      return { ok: false, field: "since" };
    }

    since = normalizeIsoDate(input.since);

    if (!since) {
      return { ok: false, field: "since" };
    }
  }

  if (
    input.author_profile_id !== undefined &&
    !isUuid(input.author_profile_id)
  ) {
    return { ok: false, field: "author_profile_id" };
  }

  return {
    authorProfileId:
      typeof input.author_profile_id === "string"
        ? input.author_profile_id.trim()
        : null,
    limit: limit.limit,
    ok: true,
    since,
  };
}

export function validateMemoryGetPayload(
  payload: unknown,
):
  | {
      ok: true;
      memoryId: string;
    }
  | {
      ok: false;
      field: MemoryReadField;
    } {
  if (!isRecord(payload) || !isUuid(payload.memory_id)) {
    return { ok: false, field: "memory_id" };
  }

  return {
    memoryId: payload.memory_id.trim(),
    ok: true,
  };
}

export async function searchMcpMemories(
  payload: unknown,
  session: Pick<ValidMcpSession, "workspaceId" | "mcpKeyId">,
  dependencies?: { rpcClient?: RpcClient },
): Promise<MemorySearchResult> {
  const validation = validateMemorySearchPayload(payload);

  if (!validation.ok) {
    return {
      field: validation.field,
      ok: false,
      reason: "invalid_input",
    };
  }

  try {
    const { data, error } = await getRpcClient(dependencies).rpc(
      "search_mcp_memories",
      {
        p_kind: validation.kind,
        p_limit: validation.limit,
        p_mcp_key_id: session.mcpKeyId,
        p_query: validation.query,
        p_tags: validation.tags,
        p_workspace_id: session.workspaceId,
      },
    );

    if (error) {
      return mapReadError(error, "read_failed");
    }

    const rows = normalizeRpcRows(data);
    const memories = rows
      .map(mapSearchRow)
      .filter((memory): memory is McpMemorySearchItem => Boolean(memory));
    const total = normalizeTotal(rows[0]?.total_count, memories.length);

    return { memories, ok: true, total };
  } catch {
    return { ok: false, reason: "read_failed" };
  }
}

export async function recallRecentMcpMemories(
  payload: unknown,
  session: Pick<ValidMcpSession, "workspaceId" | "mcpKeyId">,
  dependencies?: { rpcClient?: RpcClient },
): Promise<MemoryRecallRecentResult> {
  const validation = validateMemoryRecallRecentPayload(payload);

  if (!validation.ok) {
    return {
      field: validation.field,
      ok: false,
      reason: "invalid_input",
    };
  }

  try {
    const { data, error } = await getRpcClient(dependencies).rpc(
      "recall_recent_mcp_memories",
      {
        p_author_profile_id: validation.authorProfileId,
        p_limit: validation.limit,
        p_mcp_key_id: session.mcpKeyId,
        p_since: validation.since,
        p_workspace_id: session.workspaceId,
      },
    );

    if (error) {
      return mapReadError(error, "read_failed");
    }

    return {
      memories: normalizeRpcRows(data)
        .map(mapRecentRow)
        .filter((memory): memory is McpMemoryRecentItem => Boolean(memory)),
      ok: true,
    };
  } catch {
    return { ok: false, reason: "read_failed" };
  }
}

export async function getMcpMemory(
  payload: unknown,
  session: Pick<ValidMcpSession, "workspaceId" | "mcpKeyId">,
  dependencies?: { rpcClient?: RpcClient },
): Promise<MemoryGetResult> {
  const validation = validateMemoryGetPayload(payload);

  if (!validation.ok) {
    return {
      field: validation.field,
      ok: false,
      reason: "invalid_input",
    };
  }

  try {
    const { data, error } = await getRpcClient(dependencies).rpc(
      "get_mcp_memory",
      {
        p_mcp_key_id: session.mcpKeyId,
        p_memory_id: validation.memoryId,
        p_workspace_id: session.workspaceId,
      },
    );

    if (error) {
      return mapReadError(error, "read_failed");
    }

    const [row] = normalizeRpcRows(data);
    const memory = row ? mapGetRow(row) : null;

    if (!memory) {
      return { ok: false, reason: "not_found" };
    }

    return { memory, ok: true };
  } catch {
    return { ok: false, reason: "read_failed" };
  }
}
