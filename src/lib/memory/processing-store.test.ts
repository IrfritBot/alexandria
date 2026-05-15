import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createSupabaseMemoryProcessingDatabase } from "./processing-store";

type QueryResponse = {
  data: unknown;
  error: { message?: string } | null;
};

type QueryCall = {
  args: unknown[];
  method: string;
  table: string;
};

type Query = {
  eq: (...args: unknown[]) => Query;
  in: (...args: unknown[]) => Query;
  is: (...args: unknown[]) => Query;
  limit: (...args: unknown[]) => Promise<QueryResponse>;
  neq: (...args: unknown[]) => Query;
  not: (...args: unknown[]) => Query;
  or: (...args: unknown[]) => Promise<QueryResponse>;
  order: (...args: unknown[]) => Query;
  select: (...args: unknown[]) => Query;
};

function memoryRow(overrides: Record<string, unknown> = {}) {
  return {
    author_profile_id: null,
    content: "Ashley uses Shopify.",
    created_at: "2026-05-03T10:00:00.000Z",
    embedding: "[1,0,0]",
    id: "memory-active",
    kind: "fact",
    metadata: { source: "mcp" },
    status: "active",
    ...overrides,
  };
}

function makeQuery(
  table: string,
  response: QueryResponse,
  calls: QueryCall[],
): Query {
  const query = {} as Query;
  const chain = (method: string) =>
    vi.fn((...args: unknown[]) => {
      calls.push({ args, method, table });
      return query;
    });
  const terminal = (method: string) =>
    vi.fn(async (...args: unknown[]) => {
      calls.push({ args, method, table });
      return response;
    });

  query.select = chain("select");
  query.eq = chain("eq");
  query.neq = chain("neq");
  query.in = chain("in");
  query.is = chain("is");
  query.not = chain("not");
  query.order = chain("order");
  query.limit = terminal("limit");
  query.or = terminal("or");

  return query;
}

function makeClient(input: {
  conflictRows?: unknown[];
  memoryRows?: unknown[];
}) {
  const calls: QueryCall[] = [];
  const from = vi.fn((table: string) => {
    if (table === "memories") {
      return makeQuery(
        table,
        { data: input.memoryRows ?? [], error: null },
        calls,
      );
    }

    if (table === "conflicts") {
      return makeQuery(
        table,
        { data: input.conflictRows ?? [], error: null },
        calls,
      );
    }

    throw new Error(`unexpected table: ${table}`);
  });

  return { calls, client: { from }, from };
}

describe("createSupabaseMemoryProcessingDatabase", () => {
  it("lists same-kind and unknown candidates while excluding unresolved conflict boundaries", async () => {
    const { calls, client, from } = makeClient({
      conflictRows: [
        {
          source_memory_id: "memory-unresolved",
          target_memory_id: "memory-other",
        },
      ],
      memoryRows: [
        memoryRow({ id: "memory-active" }),
        memoryRow({
          id: "memory-classifier-review",
          kind: "unknown",
          status: "conflict",
        }),
        memoryRow({
          id: "memory-unresolved",
          status: "conflict",
        }),
      ],
    });
    const database = createSupabaseMemoryProcessingDatabase(client as never);

    const candidates = await database.listConflictCandidates({
      kind: "fact",
      limit: 200,
      memoryId: "memory-new",
      workspaceId: "workspace-1",
    });

    expect(candidates.map((candidate) => candidate.id)).toEqual([
      "memory-active",
      "memory-classifier-review",
    ]);
    expect(candidates[1]).toMatchObject({
      kind: "unknown",
      status: "conflict",
    });
    expect(from).toHaveBeenNthCalledWith(1, "memories");
    expect(from).toHaveBeenNthCalledWith(2, "conflicts");
    expect(calls).toContainEqual({
      args: ["kind", ["fact", "unknown"]],
      method: "in",
      table: "memories",
    });
    expect(calls).toContainEqual({
      args: ["status", ["active", "conflict"]],
      method: "in",
      table: "memories",
    });
    expect(calls).toContainEqual({
      args: ["deleted_at", null],
      method: "is",
      table: "memories",
    });
    expect(calls).toContainEqual({
      args: ["superseded_by_memory_id", null],
      method: "is",
      table: "memories",
    });
    expect(calls).toContainEqual({
      args: ["embedding", "is", null],
      method: "not",
      table: "memories",
    });
    expect(calls).toContainEqual({
      args: ["workspace_id", "workspace-1"],
      method: "eq",
      table: "conflicts",
    });
    expect(calls).toContainEqual({
      args: ["status", "unresolved"],
      method: "eq",
      table: "conflicts",
    });
    expect(calls).toContainEqual({
      args: ["deleted_at", null],
      method: "is",
      table: "conflicts",
    });
    expect(calls).toContainEqual({
      args: [
        "source_memory_id.in.(memory-active,memory-classifier-review,memory-unresolved),target_memory_id.in.(memory-active,memory-classifier-review,memory-unresolved)",
      ],
      method: "or",
      table: "conflicts",
    });
  });

  it("uses a single unknown-kind filter and skips conflict lookup when no candidates survive", async () => {
    const { calls, client, from } = makeClient({ memoryRows: [] });
    const database = createSupabaseMemoryProcessingDatabase(client as never);

    await expect(
      database.listConflictCandidates({
        kind: "unknown",
        limit: 200,
        memoryId: "memory-new",
        workspaceId: "workspace-1",
      }),
    ).resolves.toEqual([]);

    expect(calls).toContainEqual({
      args: ["kind", ["unknown"]],
      method: "in",
      table: "memories",
    });
    expect(from).toHaveBeenCalledTimes(1);
  });
});
