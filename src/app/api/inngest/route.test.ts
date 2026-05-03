import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  functions: [{ id: "memory-process-v1" }],
  inngest: { id: "alexandria" },
  serve: vi.fn(() => ({
    GET: vi.fn(),
    POST: vi.fn(),
    PUT: vi.fn(),
  })),
}));

vi.mock("inngest/next", () => ({
  serve: mocks.serve,
}));

vi.mock("@/lib/inngest/client", () => ({
  inngest: mocks.inngest,
}));

vi.mock("@/lib/memory/inngest", () => ({
  memoryInngestFunctions: mocks.functions,
}));

describe("inngest route", () => {
  it("registers the memory processing function", async () => {
    await import("./route");

    expect(mocks.serve).toHaveBeenCalledWith({
      client: mocks.inngest,
      functions: mocks.functions,
    });
  });
});
