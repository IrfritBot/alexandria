import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createConfiguredEmbedder,
  createDeterministicEmbedder,
  parsePgVector,
  toPgVectorLiteral,
} from "./embedder";

const originalOpenAiKey = process.env.OPENAI_API_KEY;
const originalVoyageKey = process.env.VOYAGE_API_KEY;

function restoreEnv(name: "OPENAI_API_KEY" | "VOYAGE_API_KEY", value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

describe("embedder", () => {
  afterEach(() => {
    restoreEnv("OPENAI_API_KEY", originalOpenAiKey);
    restoreEnv("VOYAGE_API_KEY", originalVoyageKey);
    vi.restoreAllMocks();
  });

  it("produces stable deterministic embeddings when provider env is absent", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.VOYAGE_API_KEY;

    const embedder = createConfiguredEmbedder();
    const first = await embedder({ content: "Ashley uses Shopify.", tier: "basic" });
    const second = await embedder({ content: "Ashley uses Shopify.", tier: "basic" });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      dimensions: 32,
      provider: "deterministic",
    });
  });

  it("uses the configured OpenAI provider path when env exists", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    const fetchImpl = vi.fn(async () => ({
      json: async () => ({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        usage: { total_tokens: 8 },
      }),
      ok: true,
      status: 200,
    }));

    await expect(
      createConfiguredEmbedder(fetchImpl)({
        content: "Ashley uses Shopify.",
        tier: "basic",
      }),
    ).resolves.toMatchObject({
      dimensions: 3,
      embedding: [0.1, 0.2, 0.3],
      provider: "openai",
      usage: { tokens: 8 },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("serializes and parses pgvector values", async () => {
    const result = await createDeterministicEmbedder(4)({
      content: "alpha beta",
      tier: "basic",
    });
    const literal = toPgVectorLiteral(result.embedding);

    expect(literal).toMatch(/^\[[\d,.-]+\]$/);
    expect(parsePgVector(literal)).toEqual(result.embedding);
  });
});
