import type {
  ClassifiedMemoryKind,
  ClassifierResult,
  MemoryClassifier,
} from "./classifier";
import { CLASSIFIER_PROMPT_VERSION } from "./classifier";
import type { EmbeddingResult, MemoryEmbedder } from "./embedder";

export type MemoryKind = ClassifiedMemoryKind | "unknown";
export type MemoryStatus = "processing" | "active" | "conflict" | "failed";
export type ProcessingTier = "basic" | "pro";

export type ProcessingMetadata = Record<string, unknown>;

export type ProcessingMemory = {
  authorProfileId: string | null;
  content: string;
  createdAt: string;
  id: string;
  kind: MemoryKind;
  kindConfidence: number | null;
  metadata: ProcessingMetadata;
  processingTier: ProcessingTier;
  status: MemoryStatus;
  supersededByMemoryId: string | null;
  workspace: {
    conflictThresholds: {
      conflict: number;
      duplicate: number;
    };
    tier: ProcessingTier;
  };
  workspaceId: string;
};

export type ConflictCandidate = {
  authorProfileId: string | null;
  content: string;
  createdAt: string;
  embedding: number[];
  id: string;
  kind: MemoryKind;
  metadata: ProcessingMetadata;
};

export type InsertConflictInput = {
  resolution?: string;
  resolutionStrategy?: string;
  resolvedAt?: string;
  sourceMemoryId: string;
  status: "unresolved" | "auto_resolved";
  targetMemoryId: string;
  winnerMemoryId?: string;
  workspaceId: string;
};

export type MemoryProcessingDatabase = {
  getMemoryForProcessing(input: {
    memoryId: string;
    workspaceId: string;
  }): Promise<ProcessingMemory | null>;
  insertAuditLog(input: {
    action: string;
    actorMcpKeyId: string | null;
    metadata: ProcessingMetadata;
    targetConflictId?: string;
    targetMemoryId?: string;
    workspaceId: string;
  }): Promise<void>;
  insertConflict(input: InsertConflictInput): Promise<{ id: string }>;
  insertMemoryRevision(input: {
    content: string;
    kind: MemoryKind;
    kindConfidence: number | null;
    memoryId: string;
    metadata: ProcessingMetadata;
    processedAt: string | null;
    processingTier: ProcessingTier;
    status: MemoryStatus;
    supersededByMemoryId: string | null;
    workspaceId: string;
  }): Promise<void>;
  insertUsageEvent(input: {
    actorMcpKeyId: string | null;
    embeddingTokens?: number;
    eventType: string;
    llmInputTokens?: number;
    llmModel?: string;
    llmOutputTokens?: number;
    processingTier: ProcessingTier;
    workspaceId: string;
  }): Promise<void>;
  listConflictCandidates(input: {
    kind: MemoryKind;
    limit: number;
    memoryId: string;
    workspaceId: string;
  }): Promise<ConflictCandidate[]>;
  updateMemory(input: {
    embedding?: number[] | null;
    kind?: MemoryKind;
    kindConfidence?: number | null;
    memoryId: string;
    metadata?: ProcessingMetadata;
    processedAt?: string;
    processingTier?: ProcessingTier;
    status?: MemoryStatus;
    supersededByMemoryId?: string | null;
    workspaceId: string;
  }): Promise<void>;
  updateMemorySupersededBy(input: {
    memoryId: string;
    supersededByMemoryId: string;
    workspaceId: string;
  }): Promise<void>;
};

export type ProcessMemoryInput = {
  mcpKeyId: string | null;
  memoryId: string;
  workspaceId: string;
};

export type ProcessMemoryResult =
  | {
      memoryId: string;
      ok: true;
      status: "active" | "conflict" | "failed";
    }
  | {
      memoryId: string;
      ok: true;
      reason: "missing" | "not_processing";
      status: "skipped";
    };

type ProviderFailure = {
  message: string;
  provider: "classifier" | "embedder";
};

type ConflictPlan = {
  band: "duplicate" | "conflict";
  candidate: ConflictCandidate;
  resolution?: string;
  resolutionStrategy?: string;
  similarity: number;
  status: "unresolved" | "auto_resolved";
  winnerMemoryId?: string;
};

const WORKER_VERSION = "memory-worker-v1";
const DEFAULT_CANDIDATE_LIMIT = 200;

function sanitizeError(error: unknown) {
  const message =
    error instanceof Error && error.message ? error.message : "provider failed";

  return message.replace(/sk-[a-z0-9_-]+/gi, "[redacted]").slice(0, 240);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestamp(value: string) {
  const parsed = Date.parse(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function candidateLimit(tier: ProcessingTier) {
  return tier === "pro" ? 20 : 5;
}

function sourceSpecificity(memory: {
  authorProfileId: string | null;
  metadata: ProcessingMetadata;
}) {
  const source = typeof memory.metadata.source === "string" ? memory.metadata.source : "";
  const sourceClient =
    typeof memory.metadata.source_client === "string"
      ? memory.metadata.source_client
      : "";

  if (source === "web" || source === "web_ui" || source === "manual") {
    return 3;
  }

  if (source === "mcp" && sourceClient && memory.authorProfileId) {
    return 2;
  }

  return 1;
}

function roleRank(memory: { metadata: ProcessingMetadata }) {
  const role =
    typeof memory.metadata.author_role === "string"
      ? memory.metadata.author_role
      : typeof memory.metadata.actor_role === "string"
        ? memory.metadata.actor_role
        : "";

  return role === "admin" ? 2 : 1;
}

function newerMemoryId(
  source: ProcessingMemory,
  target: ConflictCandidate,
  sourceRank: number,
  targetRank: number,
) {
  if (sourceRank > targetRank) {
    return source.id;
  }

  if (targetRank > sourceRank) {
    return target.id;
  }

  return timestamp(source.createdAt) >= timestamp(target.createdAt)
    ? source.id
    : target.id;
}

function chooseWinner(
  kind: MemoryKind,
  source: ProcessingMemory,
  target: ConflictCandidate,
) {
  if (kind === "policy") {
    return {
      resolutionStrategy: "rank_then_recency",
      winnerMemoryId: newerMemoryId(source, target, roleRank(source), roleRank(target)),
    };
  }

  if (kind === "fact") {
    const sourceTime = timestamp(source.createdAt);
    const targetTime = timestamp(target.createdAt);

    if (sourceTime !== targetTime) {
      return {
        resolutionStrategy: "recency_then_source",
        winnerMemoryId: sourceTime > targetTime ? source.id : target.id,
      };
    }

    return {
      resolutionStrategy: "recency_then_source",
      winnerMemoryId: newerMemoryId(
        source,
        target,
        sourceSpecificity(source),
        sourceSpecificity(target),
      ),
    };
  }

  return null;
}

export function planConflicts(input: {
  candidates: ConflictCandidate[];
  embedding: number[];
  kind: MemoryKind;
  memory: ProcessingMemory;
}) {
  const scored = input.candidates
    .map((candidate) => ({
      candidate,
      similarity: cosineSimilarity(input.embedding, candidate.embedding),
    }))
    .filter(
      (candidate) =>
        candidate.similarity >= input.memory.workspace.conflictThresholds.conflict,
    )
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, candidateLimit(input.memory.workspace.tier));

  return scored.map<ConflictPlan>((scoredCandidate, index) => {
    const band =
      scoredCandidate.similarity >=
      input.memory.workspace.conflictThresholds.duplicate
        ? "duplicate"
        : "conflict";

    if (band === "duplicate" && (input.kind === "policy" || input.kind === "fact")) {
      return {
        ...scoredCandidate,
        band,
        resolution: "duplicate_existing_wins",
        resolutionStrategy: "duplicate",
        status: "auto_resolved",
        winnerMemoryId: scoredCandidate.candidate.id,
      };
    }

    const winner = index === 0
      ? chooseWinner(input.kind, input.memory, scoredCandidate.candidate)
      : null;

    if (!winner) {
      return {
        ...scoredCandidate,
        band,
        status: "unresolved",
      };
    }

    return {
      ...scoredCandidate,
      band,
      resolution:
        winner.winnerMemoryId === input.memory.id ? "source_wins" : "target_wins",
      status: "auto_resolved",
      ...winner,
    };
  });
}

function processingMetadata(input: {
  classifierFailure: ProviderFailure | null;
  classifierResult: ClassifierResult | null;
  completedAt: string;
  conflictPlans: ConflictPlan[];
  embeddingResult?: EmbeddingResult;
  embedderFailure?: ProviderFailure;
  existingMetadata: ProcessingMetadata;
}) {
  const existingProcessing = isRecord(input.existingMetadata.processing)
    ? input.existingMetadata.processing
    : {};

  return {
    ...input.existingMetadata,
    processing: {
      ...existingProcessing,
      classifier: input.classifierFailure
        ? {
            error: input.classifierFailure.message,
            prompt_version: CLASSIFIER_PROMPT_VERSION,
            status: "failed",
          }
        : {
            confidence: input.classifierResult?.confidence ?? null,
            kind: input.classifierResult?.kind ?? "unknown",
            model: input.classifierResult?.model ?? null,
            prompt_version: CLASSIFIER_PROMPT_VERSION,
            provider: input.classifierResult?.provider ?? null,
            status: "ok",
          },
      completed_at: input.completedAt,
      conflicts: {
        auto_resolved: input.conflictPlans.filter(
          (plan) => plan.status === "auto_resolved",
        ).length,
        detected: input.conflictPlans.length,
        unresolved: input.conflictPlans.filter(
          (plan) => plan.status === "unresolved",
        ).length,
      },
      embedding: input.embedderFailure
        ? {
            error: input.embedderFailure.message,
            status: "failed",
          }
        : {
            dimensions: input.embeddingResult?.dimensions ?? null,
            model: input.embeddingResult?.model ?? null,
            provider: input.embeddingResult?.provider ?? null,
            status: "ok",
          },
      worker_version: WORKER_VERSION,
    },
  };
}

async function insertClassifierUsage(input: {
  actorMcpKeyId: string | null;
  classifierResult: ClassifierResult | null;
  database: MemoryProcessingDatabase;
  eventType: string;
  tier: ProcessingTier;
  workspaceId: string;
}) {
  await input.database.insertUsageEvent({
    actorMcpKeyId: input.actorMcpKeyId,
    eventType: input.eventType,
    llmInputTokens: input.classifierResult?.usage.inputTokens ?? 0,
    llmModel: input.classifierResult?.model,
    llmOutputTokens: input.classifierResult?.usage.outputTokens ?? 0,
    processingTier: input.tier,
    workspaceId: input.workspaceId,
  });
}

async function finalizeFailed(input: {
  actorMcpKeyId: string | null;
  classifierFailure: ProviderFailure | null;
  classifierResult: ClassifierResult | null;
  database: MemoryProcessingDatabase;
  embedderFailure: ProviderFailure;
  memory: ProcessingMemory;
  now: string;
  tier: ProcessingTier;
}) {
  const metadata = processingMetadata({
    classifierFailure: input.classifierFailure,
    classifierResult: input.classifierResult,
    completedAt: input.now,
    conflictPlans: [],
    embedderFailure: input.embedderFailure,
    existingMetadata: input.memory.metadata,
  });
  const kind = input.classifierResult?.kind ?? "unknown";
  const kindConfidence = input.classifierResult?.confidence ?? null;

  await input.database.updateMemory({
    embedding: null,
    kind,
    kindConfidence,
    memoryId: input.memory.id,
    metadata,
    processedAt: input.now,
    processingTier: input.tier,
    status: "failed",
    workspaceId: input.memory.workspaceId,
  });
  await input.database.insertMemoryRevision({
    content: input.memory.content,
    kind,
    kindConfidence,
    memoryId: input.memory.id,
    metadata,
    processedAt: input.now,
    processingTier: input.tier,
    status: "failed",
    supersededByMemoryId: input.memory.supersededByMemoryId,
    workspaceId: input.memory.workspaceId,
  });
  await input.database.insertAuditLog({
    action: "memory_processing_failed",
    actorMcpKeyId: input.actorMcpKeyId,
    metadata: {
      error: input.embedderFailure.message,
      provider: input.embedderFailure.provider,
      worker_version: WORKER_VERSION,
    },
    targetMemoryId: input.memory.id,
    workspaceId: input.memory.workspaceId,
  });
  await input.database.insertUsageEvent({
    actorMcpKeyId: input.actorMcpKeyId,
    eventType: "memory_embedding_failed",
    processingTier: input.tier,
    workspaceId: input.memory.workspaceId,
  });
}

export async function processMemory(
  input: ProcessMemoryInput,
  dependencies: {
    classifier: MemoryClassifier;
    database: MemoryProcessingDatabase;
    embedder: MemoryEmbedder;
    now?: () => Date;
  },
): Promise<ProcessMemoryResult> {
  const memory = await dependencies.database.getMemoryForProcessing({
    memoryId: input.memoryId,
    workspaceId: input.workspaceId,
  });

  if (!memory) {
    return { memoryId: input.memoryId, ok: true, reason: "missing", status: "skipped" };
  }

  if (memory.status !== "processing") {
    return {
      memoryId: input.memoryId,
      ok: true,
      reason: "not_processing",
      status: "skipped",
    };
  }

  const tier = memory.workspace.tier;
  const now = (dependencies.now?.() ?? new Date()).toISOString();
  let classifierResult: ClassifierResult | null = null;
  let classifierFailure: ProviderFailure | null = null;

  try {
    classifierResult = await dependencies.classifier({
      content: memory.content,
      tier,
    });
    await insertClassifierUsage({
      actorMcpKeyId: input.mcpKeyId,
      classifierResult,
      database: dependencies.database,
      eventType: "memory_classified",
      tier,
      workspaceId: memory.workspaceId,
    });
  } catch (error) {
    classifierFailure = {
      message: sanitizeError(error),
      provider: "classifier",
    };
    await insertClassifierUsage({
      actorMcpKeyId: input.mcpKeyId,
      classifierResult: null,
      database: dependencies.database,
      eventType: "memory_classification_failed",
      tier,
      workspaceId: memory.workspaceId,
    });
  }

  const kind: MemoryKind = classifierResult?.kind ?? "unknown";
  const kindConfidence = classifierResult?.confidence ?? null;
  let embeddingResult: EmbeddingResult;

  try {
    embeddingResult = await dependencies.embedder({
      content: memory.content,
      tier,
    });
    await dependencies.database.insertUsageEvent({
      actorMcpKeyId: input.mcpKeyId,
      embeddingTokens: embeddingResult.usage.tokens,
      eventType: "memory_embedded",
      llmModel: embeddingResult.model,
      processingTier: tier,
      workspaceId: memory.workspaceId,
    });
  } catch (error) {
    await finalizeFailed({
      actorMcpKeyId: input.mcpKeyId,
      classifierFailure,
      classifierResult,
      database: dependencies.database,
      embedderFailure: {
        message: sanitizeError(error),
        provider: "embedder",
      },
      memory,
      now,
      tier,
    });

    return { memoryId: memory.id, ok: true, status: "failed" };
  }

  const candidates = await dependencies.database.listConflictCandidates({
    kind,
    limit: DEFAULT_CANDIDATE_LIMIT,
    memoryId: memory.id,
    workspaceId: memory.workspaceId,
  });
  const conflictPlans = planConflicts({
    candidates,
    embedding: embeddingResult.embedding,
    kind,
    memory,
  });
  let supersededByMemoryId: string | null = memory.supersededByMemoryId;

  for (const plan of conflictPlans) {
    const conflict = await dependencies.database.insertConflict({
      resolution: plan.resolution,
      resolutionStrategy: plan.resolutionStrategy,
      resolvedAt: plan.status === "auto_resolved" ? now : undefined,
      sourceMemoryId: memory.id,
      status: plan.status,
      targetMemoryId: plan.candidate.id,
      winnerMemoryId: plan.winnerMemoryId,
      workspaceId: memory.workspaceId,
    });

    await dependencies.database.insertAuditLog({
      action: "conflict_detected",
      actorMcpKeyId: input.mcpKeyId,
      metadata: {
        band: plan.band,
        dedupe: plan.band === "duplicate",
        similarity: Number(plan.similarity.toFixed(6)),
        worker_version: WORKER_VERSION,
      },
      targetConflictId: conflict.id,
      targetMemoryId: memory.id,
      workspaceId: memory.workspaceId,
    });

    if (plan.status === "auto_resolved" && plan.winnerMemoryId) {
      const loserMemoryId =
        plan.winnerMemoryId === memory.id ? plan.candidate.id : memory.id;

      if (loserMemoryId === memory.id) {
        supersededByMemoryId = plan.winnerMemoryId;
      } else {
        await dependencies.database.updateMemorySupersededBy({
          memoryId: loserMemoryId,
          supersededByMemoryId: plan.winnerMemoryId,
          workspaceId: memory.workspaceId,
        });
      }

      await dependencies.database.insertAuditLog({
        action: "conflict_resolved",
        actorMcpKeyId: input.mcpKeyId,
        metadata: {
          resolution: plan.resolution,
          resolution_strategy: plan.resolutionStrategy,
          winner_memory_id: plan.winnerMemoryId,
          worker_version: WORKER_VERSION,
        },
        targetConflictId: conflict.id,
        workspaceId: memory.workspaceId,
      });
    }
  }

  const hasUnresolvedConflict = conflictPlans.some(
    (plan) => plan.status === "unresolved",
  );
  const status: MemoryStatus =
    hasUnresolvedConflict || classifierFailure ? "conflict" : "active";
  const metadata = processingMetadata({
    classifierFailure,
    classifierResult,
    completedAt: now,
    conflictPlans,
    embeddingResult,
    existingMetadata: memory.metadata,
  });

  await dependencies.database.updateMemory({
    embedding: embeddingResult.embedding,
    kind,
    kindConfidence,
    memoryId: memory.id,
    metadata,
    processedAt: now,
    processingTier: tier,
    status,
    supersededByMemoryId,
    workspaceId: memory.workspaceId,
  });
  await dependencies.database.insertMemoryRevision({
    content: memory.content,
    kind,
    kindConfidence,
    memoryId: memory.id,
    metadata,
    processedAt: now,
    processingTier: tier,
    status,
    supersededByMemoryId,
    workspaceId: memory.workspaceId,
  });
  await dependencies.database.insertAuditLog({
    action: "memory_processed",
    actorMcpKeyId: input.mcpKeyId,
    metadata: {
      kind,
      status,
      worker_version: WORKER_VERSION,
    },
    targetMemoryId: memory.id,
    workspaceId: memory.workspaceId,
  });
  await dependencies.database.insertUsageEvent({
    actorMcpKeyId: input.mcpKeyId,
    eventType: "memory_processing_completed",
    processingTier: tier,
    workspaceId: memory.workspaceId,
  });

  return { memoryId: memory.id, ok: true, status };
}
