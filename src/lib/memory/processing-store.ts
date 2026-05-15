import "server-only";

import { createSupabaseServiceRoleClient } from "../supabase/service-role";
import { parsePgVector, toPgVectorLiteral } from "./embedder";
import type {
  ConflictCandidate,
  MemoryKind,
  MemoryProcessingDatabase,
  MemoryStatus,
  ProcessingMemory,
  ProcessingMetadata,
  ProcessingTier,
} from "./processing";

type SupabaseError = {
  code?: string;
  message?: string;
};

type SupabaseClientLike = ReturnType<typeof createSupabaseServiceRoleClient>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNoError(error: SupabaseError | null, operation: string) {
  if (error) {
    throw new Error(`${operation} failed: ${error.message ?? error.code ?? "unknown"}`);
  }
}

function normalizeTier(value: unknown): ProcessingTier {
  return value === "pro" ? "pro" : "basic";
}

function normalizeKind(value: unknown): MemoryKind {
  if (
    value === "policy" ||
    value === "fact" ||
    value === "judgment" ||
    value === "unknown"
  ) {
    return value;
  }

  return "unknown";
}

function normalizeStatus(value: unknown): MemoryStatus {
  if (
    value === "processing" ||
    value === "active" ||
    value === "conflict" ||
    value === "failed"
  ) {
    return value;
  }

  return "failed";
}

function normalizeMetadata(value: unknown): ProcessingMetadata {
  return isRecord(value) ? value : {};
}

function normalizeThresholds(value: unknown) {
  const thresholds = isRecord(value) ? value : {};
  const conflict =
    typeof thresholds.conflict === "number" && thresholds.conflict > 0
      ? thresholds.conflict
      : 0.85;
  const duplicate =
    typeof thresholds.duplicate === "number" && thresholds.duplicate >= conflict
      ? thresholds.duplicate
      : 0.97;

  return { conflict, duplicate };
}

function mapMemoryRow(
  row: Record<string, unknown>,
  workspace: Record<string, unknown>,
): ProcessingMemory | null {
  if (
    typeof row.id !== "string" ||
    typeof row.workspace_id !== "string" ||
    typeof row.content !== "string"
  ) {
    return null;
  }

  return {
    authorProfileId:
      typeof row.author_profile_id === "string" ? row.author_profile_id : null,
    content: row.content,
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
    id: row.id,
    kind: normalizeKind(row.kind),
    kindConfidence:
      typeof row.kind_confidence === "number" ? row.kind_confidence : null,
    metadata: normalizeMetadata(row.metadata),
    processingTier: normalizeTier(row.processing_tier),
    status: normalizeStatus(row.status),
    supersededByMemoryId:
      typeof row.superseded_by_memory_id === "string"
        ? row.superseded_by_memory_id
        : null,
    workspace: {
      conflictThresholds: normalizeThresholds(workspace.conflict_thresholds),
      tier: normalizeTier(workspace.tier),
    },
    workspaceId: row.workspace_id,
  };
}

function mapCandidateRow(row: Record<string, unknown>): ConflictCandidate | null {
  const embedding = parsePgVector(row.embedding);

  if (
    !embedding ||
    typeof row.id !== "string" ||
    typeof row.content !== "string"
  ) {
    return null;
  }

  return {
    authorProfileId:
      typeof row.author_profile_id === "string" ? row.author_profile_id : null,
    content: row.content,
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
    embedding,
    id: row.id,
    kind: normalizeKind(row.kind),
    metadata: normalizeMetadata(row.metadata),
    status: normalizeStatus(row.status),
  };
}

function candidateKinds(kind: MemoryKind): MemoryKind[] {
  return kind === "unknown" ? ["unknown"] : [kind, "unknown"];
}

function unresolvedConflictMemoryIds(
  rows: unknown,
  candidateIds: Set<string>,
): Set<string> {
  const memoryIds = new Set<string>();

  if (!Array.isArray(rows)) {
    return memoryIds;
  }

  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }

    if (
      typeof row.source_memory_id === "string" &&
      candidateIds.has(row.source_memory_id)
    ) {
      memoryIds.add(row.source_memory_id);
    }

    if (
      typeof row.target_memory_id === "string" &&
      candidateIds.has(row.target_memory_id)
    ) {
      memoryIds.add(row.target_memory_id);
    }
  }

  return memoryIds;
}

export function createSupabaseMemoryProcessingDatabase(
  client: SupabaseClientLike = createSupabaseServiceRoleClient(),
): MemoryProcessingDatabase {
  return {
    async getMemoryForProcessing({ memoryId, workspaceId }) {
      const memoryResponse = await client
        .from("memories")
        .select(
          "id, workspace_id, author_profile_id, superseded_by_memory_id, kind, kind_confidence, status, processing_tier, content, metadata, created_at",
        )
        .eq("id", memoryId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();

      assertNoError(memoryResponse.error, "load memory");

      if (!isRecord(memoryResponse.data)) {
        return null;
      }

      const workspaceResponse = await client
        .from("workspaces")
        .select("tier, conflict_thresholds")
        .eq("id", workspaceId)
        .maybeSingle();

      assertNoError(workspaceResponse.error, "load workspace");

      if (!isRecord(workspaceResponse.data)) {
        return null;
      }

      return mapMemoryRow(memoryResponse.data, workspaceResponse.data);
    },

    async insertAuditLog(input) {
      const row: Record<string, unknown> = {
        action: input.action,
        actor_mcp_key_id: input.actorMcpKeyId,
        actor_type: "mcp_key",
        metadata: input.metadata,
        workspace_id: input.workspaceId,
      };

      if (input.targetMemoryId) {
        row.target_memory_id = input.targetMemoryId;
      }

      if (input.targetConflictId) {
        row.target_conflict_id = input.targetConflictId;
      }

      const { error } = await client.from("audit_log_memory").insert(row);

      assertNoError(error, "insert memory audit log");
    },

    async insertConflict(input) {
      const row: Record<string, unknown> = {
        source_memory_id: input.sourceMemoryId,
        status: input.status,
        target_memory_id: input.targetMemoryId,
        workspace_id: input.workspaceId,
      };

      if (input.winnerMemoryId) {
        row.winner_memory_id = input.winnerMemoryId;
      }

      if (input.resolutionStrategy) {
        row.resolution_strategy = input.resolutionStrategy;
      }

      if (input.resolution) {
        row.resolution = input.resolution;
      }

      if (input.resolvedAt) {
        row.resolved_at = input.resolvedAt;
      }

      const { data, error } = await client
        .from("conflicts")
        .insert(row)
        .select("id")
        .single();

      assertNoError(error, "insert conflict");

      if (!isRecord(data) || typeof data.id !== "string") {
        throw new Error("insert conflict failed: missing conflict id");
      }

      return { id: data.id };
    },

    async insertMemoryRevision(input) {
      const revisionResponse = await client
        .from("memory_revisions")
        .select("revision_number")
        .eq("workspace_id", input.workspaceId)
        .eq("memory_id", input.memoryId)
        .order("revision_number", { ascending: false })
        .limit(1);

      assertNoError(revisionResponse.error, "load latest memory revision");

      const [latestRevision] = Array.isArray(revisionResponse.data)
        ? revisionResponse.data
        : [];
      const latestRevisionNumber =
        isRecord(latestRevision) && typeof latestRevision.revision_number === "number"
          ? latestRevision.revision_number
          : 0;

      const { error } = await client.from("memory_revisions").insert({
        content: input.content,
        kind: input.kind,
        kind_confidence: input.kindConfidence,
        memory_id: input.memoryId,
        metadata: input.metadata,
        processed_at: input.processedAt,
        processing_tier: input.processingTier,
        revision_number: latestRevisionNumber + 1,
        status: input.status,
        superseded_by_memory_id: input.supersededByMemoryId,
        workspace_id: input.workspaceId,
      });

      assertNoError(error, "insert memory revision");
    },

    async insertUsageEvent(input) {
      const { error } = await client.from("usage_events").insert({
        actor_mcp_key_id: input.actorMcpKeyId,
        embedding_tokens: input.embeddingTokens ?? 0,
        event_type: input.eventType,
        llm_input_tokens: input.llmInputTokens ?? 0,
        llm_model: input.llmModel,
        llm_output_tokens: input.llmOutputTokens ?? 0,
        processing_tier: input.processingTier,
        workspace_id: input.workspaceId,
      });

      assertNoError(error, "insert usage event");
    },

    async listConflictCandidates(input) {
      const { data, error } = await client
        .from("memories")
        .select(
          "id, author_profile_id, kind, status, content, metadata, embedding, created_at",
        )
        .eq("workspace_id", input.workspaceId)
        .neq("id", input.memoryId)
        .in("kind", candidateKinds(input.kind))
        .in("status", ["active", "conflict"])
        .is("deleted_at", null)
        .is("superseded_by_memory_id", null)
        .not("embedding", "is", null)
        .order("updated_at", { ascending: false })
        .limit(input.limit);

      assertNoError(error, "list conflict candidates");

      if (!Array.isArray(data)) {
        return [];
      }

      const candidates = data
        .filter(isRecord)
        .map(mapCandidateRow)
        .filter((candidate): candidate is ConflictCandidate => Boolean(candidate));

      if (candidates.length === 0) {
        return [];
      }

      const candidateIds = new Set(candidates.map((candidate) => candidate.id));
      const candidateIdList = [...candidateIds].join(",");
      const conflictResponse = await client
        .from("conflicts")
        .select("source_memory_id, target_memory_id")
        .eq("workspace_id", input.workspaceId)
        .eq("status", "unresolved")
        .is("deleted_at", null)
        .or(
          `source_memory_id.in.(${candidateIdList}),target_memory_id.in.(${candidateIdList})`,
        );

      assertNoError(conflictResponse.error, "list unresolved conflict candidates");

      const unresolvedMemoryIds = unresolvedConflictMemoryIds(
        conflictResponse.data,
        candidateIds,
      );

      return candidates.filter((candidate) => !unresolvedMemoryIds.has(candidate.id));
    },

    async updateMemory(input) {
      const update: Record<string, unknown> = {};

      if (input.embedding !== undefined) {
        update.embedding = input.embedding ? toPgVectorLiteral(input.embedding) : null;
      }

      if (input.kind !== undefined) {
        update.kind = input.kind;
      }

      if (input.kindConfidence !== undefined) {
        update.kind_confidence = input.kindConfidence;
      }

      if (input.metadata !== undefined) {
        update.metadata = input.metadata;
      }

      if (input.processedAt !== undefined) {
        update.processed_at = input.processedAt;
      }

      if (input.processingTier !== undefined) {
        update.processing_tier = input.processingTier;
      }

      if (input.status !== undefined) {
        update.status = input.status;
      }

      if (input.supersededByMemoryId !== undefined) {
        update.superseded_by_memory_id = input.supersededByMemoryId;
      }

      const { error } = await client
        .from("memories")
        .update(update)
        .eq("id", input.memoryId)
        .eq("workspace_id", input.workspaceId);

      assertNoError(error, "update memory");
    },

    async updateMemorySupersededBy(input) {
      const { error } = await client
        .from("memories")
        .update({
          superseded_by_memory_id: input.supersededByMemoryId,
        })
        .eq("id", input.memoryId)
        .eq("workspace_id", input.workspaceId);

      assertNoError(error, "update superseded memory");
    },
  };
}
