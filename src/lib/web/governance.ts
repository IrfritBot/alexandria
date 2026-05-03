import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

type QueryClient = Pick<SupabaseClient, "from">;
type CountRequest = PromiseLike<{
  count: number | null;
  error: unknown;
}> & {
  eq(column: string, value: unknown): CountRequest;
  is(column: string, value: null): CountRequest;
};

export type DashboardSummary = {
  activeMemories: number;
  mcpKeys: number | null;
  unresolvedConflicts: number | null;
};

export type ConflictQueueItem = {
  createdAt: string;
  id: string;
  sourceMemory: ConflictMemory | null;
  targetMemory: ConflictMemory | null;
};

export type ConflictMemory = {
  content: string;
  id: string;
  kind: string;
  status: string;
  title: string | null;
};

export type AuditEvent = {
  action: string;
  actorLabel: string | null;
  actorType: string;
  createdAt: string;
  id: string;
  targetId: string | null;
  type: "memory" | "workspace";
};

export type UsageEvent = {
  costEstimateCents: number;
  embeddingTokens: number;
  eventType: string;
  id: string;
  llmInputTokens: number;
  llmModel: string | null;
  llmOutputTokens: number;
  occurredAt: string;
  processingTier: string;
};

export type UsageSummary = {
  costEstimateCents: number;
  embeddingTokens: number;
  events: number;
  llmInputTokens: number;
  llmOutputTokens: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rows(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data)
    ? data.filter((row): row is Record<string, unknown> => isRecord(row))
    : [];
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function mapConflictMemory(row: Record<string, unknown>): ConflictMemory | null {
  if (
    typeof row.id !== "string" ||
    typeof row.content !== "string" ||
    typeof row.kind !== "string" ||
    typeof row.status !== "string"
  ) {
    return null;
  }

  return {
    content: row.content,
    id: row.id,
    kind: row.kind,
    status: row.status,
    title: nullableString(row.title),
  };
}

function mapAuditRow(
  row: Record<string, unknown>,
  type: AuditEvent["type"],
): AuditEvent | null {
  if (
    typeof row.id !== "string" ||
    typeof row.created_at !== "string" ||
    typeof row.action !== "string" ||
    typeof row.actor_type !== "string"
  ) {
    return null;
  }

  return {
    action: row.action,
    actorLabel: nullableString(row.actor_label),
    actorType: row.actor_type,
    createdAt: row.created_at,
    id: row.id,
    targetId:
      nullableString(row.target_memory_id) ??
      nullableString(row.target_conflict_id) ??
      nullableString(row.target_workspace_tag_id) ??
      nullableString(row.target_profile_id) ??
      nullableString(row.target_mcp_key_id),
    type,
  };
}

function mapUsageRow(row: Record<string, unknown>): UsageEvent | null {
  if (
    typeof row.id !== "string" ||
    typeof row.event_type !== "string" ||
    typeof row.processing_tier !== "string" ||
    typeof row.occurred_at !== "string"
  ) {
    return null;
  }

  return {
    costEstimateCents: numberValue(row.cost_estimate_cents),
    embeddingTokens: numberValue(row.embedding_tokens),
    eventType: row.event_type,
    id: row.id,
    llmInputTokens: numberValue(row.llm_input_tokens),
    llmModel: nullableString(row.llm_model),
    llmOutputTokens: numberValue(row.llm_output_tokens),
    occurredAt: row.occurred_at,
    processingTier: row.processing_tier,
  };
}

async function countRows(
  queryClient: QueryClient,
  tableName: string,
  workspaceId: string,
  configure?: (request: CountRequest) => CountRequest,
) {
  let request = queryClient
    .from(tableName)
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId) as unknown as CountRequest;

  if (configure) {
    request = configure(request);
  }

  const { count, error } = await request;

  if (error) {
    return null;
  }

  return count ?? 0;
}

export async function getDashboardSummary(
  input: {
    isAdmin: boolean;
    workspaceId: string;
  },
  queryClient: QueryClient,
): Promise<DashboardSummary> {
  const activeMemories =
    (await countRows(queryClient, "memories", input.workspaceId, (request) =>
      request.eq("status", "active").is("deleted_at", null),
    )) ?? 0;

  if (!input.isAdmin) {
    return {
      activeMemories,
      mcpKeys: null,
      unresolvedConflicts: null,
    };
  }

  const [mcpKeys, unresolvedConflicts] = await Promise.all([
    countRows(queryClient, "mcp_keys", input.workspaceId, (request) =>
      request.is("revoked_at", null),
    ),
    countRows(queryClient, "conflicts", input.workspaceId, (request) =>
      request.eq("status", "unresolved").is("deleted_at", null),
    ),
  ]);

  return {
    activeMemories,
    mcpKeys,
    unresolvedConflicts,
  };
}

export async function listUnresolvedConflicts(
  input: {
    limit?: number;
    workspaceId: string;
  },
  queryClient: QueryClient,
): Promise<
  | {
      conflicts: ConflictQueueItem[];
      ok: true;
    }
  | { ok: false; reason: "load_failed" }
> {
  const { data, error } = await queryClient
    .from("conflicts")
    .select("id, source_memory_id, target_memory_id, created_at")
    .eq("workspace_id", input.workspaceId)
    .eq("status", "unresolved")
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(input.limit ?? 50);

  if (error) {
    return { ok: false, reason: "load_failed" };
  }

  const conflictRows = rows(data);
  const memoryIds = [
    ...new Set(
      conflictRows.flatMap((row) => [
        ...((typeof row.source_memory_id === "string" && [
          row.source_memory_id,
        ]) ||
          []),
        ...((typeof row.target_memory_id === "string" && [
          row.target_memory_id,
        ]) ||
          []),
      ]),
    ),
  ];
  const memoriesById = new Map<string, ConflictMemory>();

  if (memoryIds.length > 0) {
    const { data: memoryData, error: memoryError } = await queryClient
      .from("memories")
      .select("id, title, content, kind, status")
      .eq("workspace_id", input.workspaceId)
      .in("id", memoryIds)
      .is("deleted_at", null);

    if (memoryError) {
      return { ok: false, reason: "load_failed" };
    }

    for (const memoryRow of rows(memoryData)) {
      const memory = mapConflictMemory(memoryRow);

      if (memory) {
        memoriesById.set(memory.id, memory);
      }
    }
  }

  return {
    conflicts: conflictRows.flatMap((row) => {
      if (
        typeof row.id !== "string" ||
        typeof row.created_at !== "string" ||
        typeof row.source_memory_id !== "string" ||
        typeof row.target_memory_id !== "string"
      ) {
        return [];
      }

      return [
        {
          createdAt: row.created_at,
          id: row.id,
          sourceMemory: memoriesById.get(row.source_memory_id) ?? null,
          targetMemory: memoriesById.get(row.target_memory_id) ?? null,
        },
      ];
    }),
    ok: true,
  };
}

export async function listAuditEvents(
  input: {
    limit?: number;
    workspaceId: string;
  },
  queryClient: QueryClient,
): Promise<
  | {
      events: AuditEvent[];
      ok: true;
    }
  | { ok: false; reason: "load_failed" }
> {
  const limit = input.limit ?? 25;
  const [workspaceResponse, memoryResponse] = await Promise.all([
    queryClient
      .from("audit_log_workspace")
      .select(
        "id, actor_type, actor_label, action, target_profile_id, target_mcp_key_id, created_at",
      )
      .eq("workspace_id", input.workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit),
    queryClient
      .from("audit_log_memory")
      .select(
        "id, actor_type, actor_label, action, target_memory_id, target_conflict_id, target_workspace_tag_id, created_at",
      )
      .eq("workspace_id", input.workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  if (workspaceResponse.error || memoryResponse.error) {
    return { ok: false, reason: "load_failed" };
  }

  return {
    events: [
      ...rows(workspaceResponse.data).flatMap((row) => {
        const event = mapAuditRow(row, "workspace");
        return event ? [event] : [];
      }),
      ...rows(memoryResponse.data).flatMap((row) => {
        const event = mapAuditRow(row, "memory");
        return event ? [event] : [];
      }),
    ]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit),
    ok: true,
  };
}

export async function listUsageEvents(
  input: {
    limit?: number;
    workspaceId: string;
  },
  queryClient: QueryClient,
): Promise<
  | {
      events: UsageEvent[];
      ok: true;
      summary: UsageSummary;
    }
  | { ok: false; reason: "load_failed" }
> {
  const { data, error } = await queryClient
    .from("usage_events")
    .select(
      "id, event_type, processing_tier, llm_input_tokens, llm_output_tokens, llm_model, embedding_tokens, cost_estimate_cents, occurred_at",
    )
    .eq("workspace_id", input.workspaceId)
    .order("occurred_at", { ascending: false })
    .limit(input.limit ?? 50);

  if (error) {
    return { ok: false, reason: "load_failed" };
  }

  const events = rows(data).flatMap((row) => {
    const event = mapUsageRow(row);
    return event ? [event] : [];
  });
  const summary = events.reduce<UsageSummary>(
    (totals, event) => ({
      costEstimateCents: totals.costEstimateCents + event.costEstimateCents,
      embeddingTokens: totals.embeddingTokens + event.embeddingTokens,
      events: totals.events + 1,
      llmInputTokens: totals.llmInputTokens + event.llmInputTokens,
      llmOutputTokens: totals.llmOutputTokens + event.llmOutputTokens,
    }),
    {
      costEstimateCents: 0,
      embeddingTokens: 0,
      events: 0,
      llmInputTokens: 0,
      llmOutputTokens: 0,
    },
  );

  return {
    events,
    ok: true,
    summary,
  };
}

export function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function snippet(content: string, length = 180) {
  const normalized = content.replace(/\s+/g, " ").trim();

  if (normalized.length <= length) {
    return normalized;
  }

  return `${normalized.slice(0, length - 1)}...`;
}

export function titleOrId(title: string | null, id: string) {
  return title ?? `Memory ${stringValue(id).slice(0, 8)}`;
}
