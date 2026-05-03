import { describe, expect, it, vi } from "vitest";

import type {
  ClassifierResult,
  MemoryClassifier,
} from "./classifier";
import type { EmbeddingResult, MemoryEmbedder } from "./embedder";
import {
  type ConflictCandidate,
  type MemoryProcessingDatabase,
  type ProcessingMemory,
  processMemory,
} from "./processing";

function classifierResult(
  kind: ClassifierResult["kind"],
  confidence = 0.9,
): ClassifierResult {
  return {
    confidence,
    kind,
    model: "test-classifier",
    promptVersion: "classifier/v1",
    provider: "deterministic",
    suggestedTags: [],
    usage: {
      inputTokens: 3,
      outputTokens: 2,
    },
  };
}

function embeddingResult(embedding = [1, 0, 0]): EmbeddingResult {
  return {
    dimensions: embedding.length,
    embedding,
    model: "test-embedder",
    provider: "deterministic",
    usage: {
      tokens: 4,
    },
  };
}

function memory(overrides: Partial<ProcessingMemory> = {}): ProcessingMemory {
  return {
    authorProfileId: null,
    content: "Ashley uses Shopify.",
    createdAt: "2026-05-03T10:00:00.000Z",
    id: "memory-new",
    kind: "unknown",
    kindConfidence: null,
    metadata: { source: "mcp" },
    processingTier: "basic",
    status: "processing",
    supersededByMemoryId: null,
    workspace: {
      conflictThresholds: {
        conflict: 0.85,
        duplicate: 0.97,
      },
      tier: "basic",
    },
    workspaceId: "workspace-1",
    ...overrides,
  };
}

function candidate(overrides: Partial<ConflictCandidate> = {}): ConflictCandidate {
  return {
    authorProfileId: null,
    content: "Ashley uses Shopify.",
    createdAt: "2026-05-02T10:00:00.000Z",
    embedding: [1, 0, 0],
    id: "memory-old",
    kind: "fact",
    metadata: { source: "mcp" },
    ...overrides,
  };
}

function fakeDatabase(
  currentMemory: ProcessingMemory | null,
  candidates: ConflictCandidate[] = [],
) {
  const calls = {
    audits: [] as Parameters<MemoryProcessingDatabase["insertAuditLog"]>[0][],
    conflicts: [] as Parameters<MemoryProcessingDatabase["insertConflict"]>[0][],
    revisions: [] as Parameters<
      MemoryProcessingDatabase["insertMemoryRevision"]
    >[0][],
    superseded: [] as Parameters<
      MemoryProcessingDatabase["updateMemorySupersededBy"]
    >[0][],
    updates: [] as Parameters<MemoryProcessingDatabase["updateMemory"]>[0][],
    usage: [] as Parameters<MemoryProcessingDatabase["insertUsageEvent"]>[0][],
  };
  const database: MemoryProcessingDatabase = {
    async getMemoryForProcessing() {
      return currentMemory;
    },
    async insertAuditLog(input) {
      calls.audits.push(input);
    },
    async insertConflict(input) {
      calls.conflicts.push(input);
      return { id: `conflict-${calls.conflicts.length}` };
    },
    async insertMemoryRevision(input) {
      calls.revisions.push(input);
    },
    async insertUsageEvent(input) {
      calls.usage.push(input);
    },
    async listConflictCandidates() {
      return candidates;
    },
    async updateMemory(input) {
      calls.updates.push(input);
    },
    async updateMemorySupersededBy(input) {
      calls.superseded.push(input);
    },
  };

  return { calls, database };
}

const fixedNow = () => new Date("2026-05-03T12:00:00.000Z");

describe("processMemory", () => {
  it("classifies, embeds, writes usage/audit/revision, and activates independent memories", async () => {
    const { calls, database } = fakeDatabase(memory());
    const classifier: MemoryClassifier = vi.fn(async () => classifierResult("fact"));
    const embedder: MemoryEmbedder = vi.fn(async () => embeddingResult());

    await expect(
      processMemory(
        {
          mcpKeyId: "mcp-key-1",
          memoryId: "memory-new",
          workspaceId: "workspace-1",
        },
        { classifier, database, embedder, now: fixedNow },
      ),
    ).resolves.toEqual({
      memoryId: "memory-new",
      ok: true,
      status: "active",
    });

    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0]).toMatchObject({
      kind: "fact",
      kindConfidence: 0.9,
      memoryId: "memory-new",
      status: "active",
    });
    expect(calls.revisions).toHaveLength(1);
    expect(calls.revisions[0]).toMatchObject({
      kind: "fact",
      status: "active",
    });
    expect(calls.audits.map((audit) => audit.action)).toEqual([
      "memory_processed",
    ]);
    expect(calls.usage.map((usage) => usage.eventType)).toEqual([
      "memory_classified",
      "memory_embedded",
      "memory_processing_completed",
    ]);
  });

  it("auto-resolves fact conflicts by recency and supersedes the older memory", async () => {
    const { calls, database } = fakeDatabase(memory(), [
      candidate({ embedding: [0.86, 0.51, 0] }),
    ]);

    await processMemory(
      {
        mcpKeyId: "mcp-key-1",
        memoryId: "memory-new",
        workspaceId: "workspace-1",
      },
      {
        classifier: async () => classifierResult("fact"),
        database,
        embedder: async () => embeddingResult([1, 0, 0]),
        now: fixedNow,
      },
    );

    expect(calls.conflicts).toEqual([
      expect.objectContaining({
        resolution: "source_wins",
        resolutionStrategy: "recency_then_source",
        status: "auto_resolved",
        targetMemoryId: "memory-old",
        winnerMemoryId: "memory-new",
      }),
    ]);
    expect(calls.superseded).toEqual([
      {
        memoryId: "memory-old",
        supersededByMemoryId: "memory-new",
        workspaceId: "workspace-1",
      },
    ]);
    expect(calls.updates[0]).toMatchObject({ status: "active" });
    expect(calls.audits.map((audit) => audit.action)).toEqual([
      "conflict_detected",
      "conflict_resolved",
      "memory_processed",
    ]);
  });

  it("queues judgment conflicts without auto-resolution", async () => {
    const { calls, database } = fakeDatabase(memory(), [
      candidate({
        embedding: [0.9, 0.1, 0],
        id: "memory-judgment",
        kind: "judgment",
      }),
    ]);

    await processMemory(
      {
        mcpKeyId: "mcp-key-1",
        memoryId: "memory-new",
        workspaceId: "workspace-1",
      },
      {
        classifier: async () => classifierResult("judgment"),
        database,
        embedder: async () => embeddingResult([1, 0, 0]),
        now: fixedNow,
      },
    );

    expect(calls.conflicts).toEqual([
      expect.objectContaining({
        status: "unresolved",
        targetMemoryId: "memory-judgment",
      }),
    ]);
    expect(calls.superseded).toEqual([]);
    expect(calls.updates[0]).toMatchObject({
      status: "conflict",
      supersededByMemoryId: null,
    });
  });

  it("sets inspectable failed state and metadata on embedder provider failure", async () => {
    const { calls, database } = fakeDatabase(memory());

    await expect(
      processMemory(
        {
          mcpKeyId: "mcp-key-1",
          memoryId: "memory-new",
          workspaceId: "workspace-1",
        },
        {
          classifier: async () => classifierResult("fact"),
          database,
          embedder: async () => {
            throw new Error("provider timeout");
          },
          now: fixedNow,
        },
      ),
    ).resolves.toEqual({
      memoryId: "memory-new",
      ok: true,
      status: "failed",
    });

    expect(calls.conflicts).toEqual([]);
    expect(calls.updates[0]).toMatchObject({
      kind: "fact",
      status: "failed",
    });
    expect(calls.updates[0].metadata).toMatchObject({
      processing: {
        embedding: {
          error: "provider timeout",
          status: "failed",
        },
      },
    });
    expect(calls.revisions[0]).toMatchObject({
      kind: "fact",
      status: "failed",
    });
    expect(calls.audits.map((audit) => audit.action)).toEqual([
      "memory_processing_failed",
    ]);
  });

  it("marks classifier failures as conflict-reviewable metadata instead of dropping the memory", async () => {
    const { calls, database } = fakeDatabase(memory());

    await expect(
      processMemory(
        {
          mcpKeyId: "mcp-key-1",
          memoryId: "memory-new",
          workspaceId: "workspace-1",
        },
        {
          classifier: async () => {
            throw new Error("classifier invalid JSON");
          },
          database,
          embedder: async () => embeddingResult(),
          now: fixedNow,
        },
      ),
    ).resolves.toEqual({
      memoryId: "memory-new",
      ok: true,
      status: "conflict",
    });

    expect(calls.updates[0]).toMatchObject({
      kind: "unknown",
      kindConfidence: null,
      status: "conflict",
    });
    expect(calls.updates[0].metadata).toMatchObject({
      processing: {
        classifier: {
          error: "classifier invalid JSON",
          status: "failed",
        },
      },
    });
    expect(calls.usage.map((usage) => usage.eventType)).toContain(
      "memory_classification_failed",
    );
  });
});
