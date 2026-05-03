import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type WebMemoryKind = "fact" | "judgment" | "policy" | "unknown";
export type WebMemoryStatus = "active" | "conflict" | "failed" | "processing";
export type WebMemorySource = "import" | "mcp" | "web_ui";

export type WebMemoryListItem = {
  authorLabel: string;
  content: string;
  createdAt: string;
  id: string;
  kind: WebMemoryKind;
  source: WebMemorySource;
  sourceClient: string | null;
  status: WebMemoryStatus;
  supersededByMemoryId: string | null;
  tags: string[];
  title: string | null;
  updatedAt: string;
};

export type WebMemoryDetail = WebMemoryListItem & {
  processedAt: string | null;
};

export type WebMemoryRevision = {
  createdAt: string;
  id: string;
  kind: WebMemoryKind;
  revisionNumber: number;
  status: WebMemoryStatus;
};

export type ListWebMemoriesResult =
  | {
      memories: WebMemoryListItem[];
      ok: true;
    }
  | {
      ok: false;
      reason: "load_failed";
    };

export type GetWebMemoryResult =
  | {
      memory: WebMemoryDetail;
      ok: true;
      revisions: WebMemoryRevision[];
    }
  | {
      ok: false;
      reason: "load_failed" | "not_found";
    };

type QueryClient = Pick<SupabaseClient, "from">;

const MEMORY_SELECT =
  "id, title, content, kind, status, author_profile_id, metadata, superseded_by_memory_id, created_at, updated_at, processed_at";
const MAX_MEMORY_LIMIT = 100;
const DEFAULT_MEMORY_LIMIT = 30;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rows(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data)
    ? data.filter((row): row is Record<string, unknown> => isRecord(row))
    : [];
}

function isKind(value: unknown): value is WebMemoryKind {
  return (
    value === "fact" ||
    value === "judgment" ||
    value === "policy" ||
    value === "unknown"
  );
}

function isStatus(value: unknown): value is WebMemoryStatus {
  return (
    value === "active" ||
    value === "conflict" ||
    value === "failed" ||
    value === "processing"
  );
}

function normalizeSource(
  value: unknown,
  authorProfileId: unknown,
): WebMemorySource {
  if (value === "import" || value === "mcp" || value === "web_ui") {
    return value;
  }

  if (value === "manual" || value === "web" || typeof authorProfileId === "string") {
    return "web_ui";
  }

  return "mcp";
}

function trimString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function getMetadata(row: Record<string, unknown>) {
  return isRecord(row.metadata) ? row.metadata : {};
}

function getAuthorLabel(row: Record<string, unknown>) {
  const metadata = getMetadata(row);

  return (
    trimString(metadata.author_label) ??
    trimString(metadata.source_client) ??
    (typeof row.author_profile_id === "string" ? "Workspace member" : "MCP key")
  );
}

function mapMemoryRow(
  row: Record<string, unknown>,
  tagsByMemoryId: Map<string, string[]>,
): WebMemoryDetail | null {
  if (
    typeof row.id !== "string" ||
    typeof row.content !== "string" ||
    !isKind(row.kind) ||
    !isStatus(row.status) ||
    typeof row.created_at !== "string" ||
    typeof row.updated_at !== "string"
  ) {
    return null;
  }

  const metadata = getMetadata(row);

  return {
    authorLabel: getAuthorLabel(row),
    content: row.content,
    createdAt: row.created_at,
    id: row.id,
    kind: row.kind,
    processedAt:
      typeof row.processed_at === "string" ? row.processed_at : null,
    source: normalizeSource(metadata.source, row.author_profile_id),
    sourceClient: trimString(metadata.source_client),
    status: row.status,
    supersededByMemoryId:
      typeof row.superseded_by_memory_id === "string"
        ? row.superseded_by_memory_id
        : null,
    tags: tagsByMemoryId.get(row.id) ?? [],
    title: trimString(row.title),
    updatedAt: row.updated_at,
  };
}

function mapRevisionRow(row: Record<string, unknown>): WebMemoryRevision | null {
  if (
    typeof row.id !== "string" ||
    typeof row.created_at !== "string" ||
    typeof row.revision_number !== "number" ||
    !isKind(row.kind) ||
    !isStatus(row.status)
  ) {
    return null;
  }

  return {
    createdAt: row.created_at,
    id: row.id,
    kind: row.kind,
    revisionNumber: row.revision_number,
    status: row.status,
  };
}

function getTagName(value: unknown) {
  if (Array.isArray(value)) {
    return trimString(value[0]?.name);
  }

  if (isRecord(value)) {
    return trimString(value.name);
  }

  return null;
}

async function listMemoryTags(
  workspaceId: string,
  memoryIds: string[],
  queryClient: QueryClient,
) {
  const tagsByMemoryId = new Map<string, string[]>();

  if (memoryIds.length === 0) {
    return { ok: true as const, tagsByMemoryId };
  }

  const { data, error } = await queryClient
    .from("memory_tags")
    .select("memory_id, workspace_tags(name)")
    .eq("workspace_id", workspaceId)
    .in("memory_id", memoryIds)
    .is("deleted_at", null);

  if (error) {
    return { ok: false as const };
  }

  for (const row of rows(data)) {
    if (typeof row.memory_id !== "string") {
      continue;
    }

    const tagName = getTagName(row.workspace_tags);

    if (!tagName) {
      continue;
    }

    tagsByMemoryId.set(row.memory_id, [
      ...(tagsByMemoryId.get(row.memory_id) ?? []),
      tagName,
    ]);
  }

  return { ok: true as const, tagsByMemoryId };
}

function normalizedLimit(limit: number | undefined) {
  if (!limit || !Number.isInteger(limit) || limit < 1) {
    return DEFAULT_MEMORY_LIMIT;
  }

  return Math.min(limit, MAX_MEMORY_LIMIT);
}

export function normalizeMemoryKindFilter(value: unknown): WebMemoryKind | null {
  return isKind(value) ? value : null;
}

export async function listWebMemories(
  input: {
    kind?: WebMemoryKind | null;
    limit?: number;
    query?: string | null;
    workspaceId: string;
  },
  queryClient: QueryClient,
): Promise<ListWebMemoriesResult> {
  const searchQuery = input.query?.trim();
  let request = queryClient
    .from("memories")
    .select(MEMORY_SELECT)
    .eq("workspace_id", input.workspaceId)
    .is("deleted_at", null)
    .is("superseded_by_memory_id", null);

  if (input.kind) {
    request = request.eq("kind", input.kind);
  }

  if (searchQuery) {
    request = request.textSearch("search_document", searchQuery, {
      config: "english",
      type: "websearch",
    });
  }

  const { data, error } = await request
    .order("updated_at", { ascending: false })
    .limit(normalizedLimit(input.limit));

  if (error) {
    return { ok: false, reason: "load_failed" };
  }

  const memoryRows = rows(data);
  const tagResult = await listMemoryTags(
    input.workspaceId,
    memoryRows.flatMap((row) => (typeof row.id === "string" ? [row.id] : [])),
    queryClient,
  );

  if (!tagResult.ok) {
    return { ok: false, reason: "load_failed" };
  }

  return {
    memories: memoryRows.flatMap((row) => {
      const memory = mapMemoryRow(row, tagResult.tagsByMemoryId);
      return memory ? [memory] : [];
    }),
    ok: true,
  };
}

export async function getWebMemory(
  input: {
    memoryId: string;
    workspaceId: string;
  },
  queryClient: QueryClient,
): Promise<GetWebMemoryResult> {
  const { data, error } = await queryClient
    .from("memories")
    .select(MEMORY_SELECT)
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.memoryId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    return { ok: false, reason: "load_failed" };
  }

  if (!data) {
    return { ok: false, reason: "not_found" };
  }

  const tagResult = await listMemoryTags(
    input.workspaceId,
    [input.memoryId],
    queryClient,
  );

  if (!tagResult.ok) {
    return { ok: false, reason: "load_failed" };
  }

  const memory = mapMemoryRow(
    data as Record<string, unknown>,
    tagResult.tagsByMemoryId,
  );

  if (!memory) {
    return { ok: false, reason: "not_found" };
  }

  const { data: revisionData, error: revisionError } = await queryClient
    .from("memory_revisions")
    .select("id, revision_number, kind, status, created_at")
    .eq("workspace_id", input.workspaceId)
    .eq("memory_id", input.memoryId)
    .is("deleted_at", null)
    .order("revision_number", { ascending: false })
    .limit(10);

  if (revisionError) {
    return { ok: false, reason: "load_failed" };
  }

  return {
    memory,
    ok: true,
    revisions: rows(revisionData).flatMap((row) => {
      const revision = mapRevisionRow(row);
      return revision ? [revision] : [];
    }),
  };
}
