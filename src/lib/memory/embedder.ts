import { createHash } from "node:crypto";

export type EmbeddingResult = {
  dimensions: number;
  embedding: number[];
  model: string;
  provider: "openai" | "voyage" | "deterministic";
  usage: {
    tokens: number;
  };
};

export type MemoryEmbedder = (input: {
  content: string;
  tier: "basic" | "pro";
}) => Promise<EmbeddingResult>;

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<{
  json(): Promise<unknown>;
  ok: boolean;
  status: number;
}>;

export class EmbedderProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbedderProviderError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest();
}

function normalize(vector: number[]) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

  if (magnitude === 0) {
    return vector;
  }

  return vector.map((value) => Number((value / magnitude).toFixed(8)));
}

export function createDeterministicEmbedder(dimensions = 32): MemoryEmbedder {
  return async ({ content }) => {
    const vector = Array.from({ length: dimensions }, () => 0);
    const tokens = content.toLowerCase().match(/[a-z0-9]+/g) ?? [content];

    for (const token of tokens) {
      const hash = hashToken(token);
      const index = hash[0] % dimensions;
      const sign = hash[1] % 2 === 0 ? 1 : -1;
      vector[index] += sign;
    }

    return {
      dimensions,
      embedding: normalize(vector),
      model: `deterministic-token-hash-${dimensions}`,
      provider: "deterministic",
      usage: {
        tokens: 0,
      },
    };
  };
}

function getOpenAiModel() {
  return process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
}

function getVoyageModel() {
  return process.env.VOYAGE_EMBEDDING_MODEL ?? "voyage-3";
}

function parseProviderEmbedding(data: unknown, provider: "openai" | "voyage") {
  if (!isRecord(data) || !Array.isArray(data.data)) {
    throw new EmbedderProviderError(`${provider} returned an invalid response`);
  }

  const [first] = data.data;

  if (!isRecord(first) || !Array.isArray(first.embedding)) {
    throw new EmbedderProviderError(`${provider} returned no embedding`);
  }

  const embedding = first.embedding.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );

  if (embedding.length !== first.embedding.length || embedding.length === 0) {
    throw new EmbedderProviderError(`${provider} returned an invalid embedding`);
  }

  return embedding;
}

function parseOpenAiTokens(data: unknown) {
  if (!isRecord(data) || !isRecord(data.usage)) {
    return 0;
  }

  return typeof data.usage.total_tokens === "number" ? data.usage.total_tokens : 0;
}

function parseVoyageTokens(data: unknown) {
  if (!isRecord(data) || !isRecord(data.usage)) {
    return 0;
  }

  return typeof data.usage.total_tokens === "number" ? data.usage.total_tokens : 0;
}

async function embedWithOpenAi(
  content: string,
  fetchImpl: FetchLike,
): Promise<EmbeddingResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return createDeterministicEmbedder()({ content, tier: "basic" });
  }

  const model = getOpenAiModel();
  const response = await fetchImpl("https://api.openai.com/v1/embeddings", {
    body: JSON.stringify({
      input: content,
      model,
    }),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new EmbedderProviderError(
      `embedding provider failed with status ${response.status}`,
    );
  }

  const data = await response.json();
  const embedding = parseProviderEmbedding(data, "openai");

  return {
    dimensions: embedding.length,
    embedding,
    model,
    provider: "openai",
    usage: {
      tokens: parseOpenAiTokens(data),
    },
  };
}

async function embedWithVoyage(
  content: string,
  fetchImpl: FetchLike,
): Promise<EmbeddingResult> {
  const apiKey = process.env.VOYAGE_API_KEY;

  if (!apiKey) {
    return embedWithOpenAi(content, fetchImpl);
  }

  const model = getVoyageModel();
  const response = await fetchImpl("https://api.voyageai.com/v1/embeddings", {
    body: JSON.stringify({
      input: [content],
      model,
    }),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new EmbedderProviderError(
      `embedding provider failed with status ${response.status}`,
    );
  }

  const data = await response.json();
  const embedding = parseProviderEmbedding(data, "voyage");

  return {
    dimensions: embedding.length,
    embedding,
    model,
    provider: "voyage",
    usage: {
      tokens: parseVoyageTokens(data),
    },
  };
}

export function createConfiguredEmbedder(fetchImpl: FetchLike = fetch): MemoryEmbedder {
  return async ({ content, tier }) => {
    if (tier === "pro") {
      return embedWithVoyage(content, fetchImpl);
    }

    return embedWithOpenAi(content, fetchImpl);
  };
}

export function toPgVectorLiteral(embedding: number[]) {
  return `[${embedding.map((value) => Number(value.toFixed(8))).join(",")}]`;
}

export function parsePgVector(value: unknown) {
  if (Array.isArray(value)) {
    const vector = value.filter(
      (item): item is number => typeof item === "number" && Number.isFinite(item),
    );

    return vector.length === value.length ? vector : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().replace(/^\[/, "").replace(/\]$/, "");

  if (!trimmed) {
    return null;
  }

  const vector = trimmed.split(",").map((item) => Number(item.trim()));

  return vector.every((item) => Number.isFinite(item)) ? vector : null;
}
