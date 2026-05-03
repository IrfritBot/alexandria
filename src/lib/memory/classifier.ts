export const CLASSIFIER_PROMPT_VERSION = "classifier/v1";

const VALID_KINDS = ["policy", "fact", "judgment"] as const;

export type ClassifiedMemoryKind = (typeof VALID_KINDS)[number];

export type ClassifierUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type ClassifierResult = {
  confidence: number;
  kind: ClassifiedMemoryKind;
  model: string;
  promptVersion: typeof CLASSIFIER_PROMPT_VERSION;
  provider: "anthropic" | "deterministic";
  suggestedTags: string[];
  usage: ClassifierUsage;
};

export type MemoryClassifier = (input: {
  content: string;
  tier: "basic" | "pro";
}) => Promise<ClassifierResult>;

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<{
  json(): Promise<unknown>;
  ok: boolean;
  status: number;
}>;

type AnthropicTextBlock = {
  text?: unknown;
  type?: unknown;
};

export class ClassifierProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClassifierProviderError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampConfidence(value: unknown) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

function isClassifiedMemoryKind(value: unknown): value is ClassifiedMemoryKind {
  return VALID_KINDS.includes(value as ClassifiedMemoryKind);
}

function normalizeSuggestedTags(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((tag): tag is string => typeof tag === "string");
}

export function buildClassifierPrompt(content: string) {
  return `You are classifying a piece of company knowledge into one of three kinds.
Your output drives downstream conflict-resolution behavior, so be careful.

KINDS:

- "policy" - rules, decisions, organizational stances. The kind of thing
  that holds true until explicitly changed.
  Examples:
  - "We don't sell to crypto-related clients."
  - "Refunds within 30 days, no questions asked."
  - "Reverie is our hero brand creative for 2026."
  - "Pricing is set quarterly by the founders."

- "fact" - claims about the world that have a definite right answer.
  Verifiable, time-anchored.
  Examples:
  - "Client Ashley Stambouli uses Shopify."
  - "Their .com renews June 12, 2026."
  - "MTO ticket prices range $700-2000."
  - "Mike's email is mike@webmymoney.com."

- "judgment" - interpretations, opinions, priority calls. Things where two
  reasonable people could disagree.
  Examples:
  - "This client is high-touch and worth founder attention."
  - "Channel performance was strong in Q1."
  - "We should focus more on retargeting."
  - "Reverie is performing better than New Collection."

RULES:
1. If the content is ambiguous or doesn't clearly fit one kind, return
   "judgment" with confidence <= 0.6. Better to defer than misclassify.
2. Do not invent context. Use only what's in the content.
3. Suggested tags should be specific. Prefer hierarchical slash format:
   "client/ashley-stambouli" over "ashley".
4. Confidence should reflect actual uncertainty, not be padded toward 1.0.

OUTPUT (strict JSON, no prose):
{
  "kind": "policy" | "fact" | "judgment",
  "confidence": number between 0.0 and 1.0,
  "suggested_tags": [string, ...]
}

CONTENT TO CLASSIFY:
${content}`;
}

export function parseClassifierJson(text: string): Pick<
  ClassifierResult,
  "confidence" | "kind" | "suggestedTags"
> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ClassifierProviderError("classifier returned invalid JSON");
  }

  if (!isRecord(parsed) || !isClassifiedMemoryKind(parsed.kind)) {
    throw new ClassifierProviderError("classifier returned an invalid kind");
  }

  return {
    confidence: clampConfidence(parsed.confidence),
    kind: parsed.kind,
    suggestedTags: normalizeSuggestedTags(parsed.suggested_tags),
  };
}

function fallbackKind(content: string): Pick<
  ClassifierResult,
  "confidence" | "kind" | "suggestedTags"
> {
  const lower = content.toLowerCase();
  const hasPolicySignal =
    /\b(never|always|must|required|requires|rule|policy|default|decided|decision|do not|don't|no longer)\b/.test(
      lower,
    ) || /\bwe\s+(cap|require|ban|only|do not|don't|never|always)\b/.test(lower);
  const hasJudgmentSignal =
    /\b(think|probably|should|worth|better|worse|strong|weak|priority|prefer|focus)\b/.test(
      lower,
    );
  const hasFactSignal =
    /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/.test(lower) ||
    /\b\d{4}\b/.test(lower) ||
    /\b(uses|is|are|was|were|has|renew|renews|costs|ranges|signed|ships)\b/.test(
      lower,
    );

  if (hasPolicySignal && !hasJudgmentSignal) {
    return { confidence: 0.72, kind: "policy", suggestedTags: [] };
  }

  if (hasFactSignal && !hasJudgmentSignal) {
    return { confidence: 0.68, kind: "fact", suggestedTags: [] };
  }

  return { confidence: hasJudgmentSignal ? 0.6 : 0.55, kind: "judgment", suggestedTags: [] };
}

export function createDeterministicClassifier(): MemoryClassifier {
  return async ({ content }) => ({
    ...fallbackKind(content),
    model: "deterministic-classifier-v1",
    promptVersion: CLASSIFIER_PROMPT_VERSION,
    provider: "deterministic",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
    },
  });
}

function getAnthropicModel(tier: "basic" | "pro") {
  if (tier === "pro") {
    return (
      process.env.ANTHROPIC_PRO_CLASSIFIER_MODEL ??
      process.env.ANTHROPIC_CLASSIFIER_MODEL ??
      "claude-3-5-sonnet-latest"
    );
  }

  return (
    process.env.ANTHROPIC_BASIC_CLASSIFIER_MODEL ??
    process.env.ANTHROPIC_CLASSIFIER_MODEL ??
    "claude-3-5-haiku-latest"
  );
}

function getAnthropicText(data: unknown) {
  if (!isRecord(data) || !Array.isArray(data.content)) {
    throw new ClassifierProviderError("classifier returned an invalid response");
  }

  const text = data.content
    .map((block: AnthropicTextBlock) =>
      isRecord(block) && block.type === "text" && typeof block.text === "string"
        ? block.text
        : "",
    )
    .join("")
    .trim();

  if (!text) {
    throw new ClassifierProviderError("classifier returned an empty response");
  }

  return text;
}

function getAnthropicUsage(data: unknown): ClassifierUsage {
  if (!isRecord(data) || !isRecord(data.usage)) {
    return { inputTokens: 0, outputTokens: 0 };
  }

  return {
    inputTokens:
      typeof data.usage.input_tokens === "number" ? data.usage.input_tokens : 0,
    outputTokens:
      typeof data.usage.output_tokens === "number" ? data.usage.output_tokens : 0,
  };
}

function createAnthropicClassifier(fetchImpl: FetchLike): MemoryClassifier {
  return async ({ content, tier }) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return createDeterministicClassifier()({ content, tier });
    }

    const model = getAnthropicModel(tier);
    const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      body: JSON.stringify({
        max_tokens: 512,
        messages: [
          {
            content: buildClassifierPrompt(content),
            role: "user",
          },
        ],
        model,
        temperature: 0,
      }),
      headers: {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new ClassifierProviderError(
        `classifier provider failed with status ${response.status}`,
      );
    }

    const data = await response.json();
    const parsed = parseClassifierJson(getAnthropicText(data));

    return {
      ...parsed,
      model,
      promptVersion: CLASSIFIER_PROMPT_VERSION,
      provider: "anthropic",
      usage: getAnthropicUsage(data),
    };
  };
}

export function createConfiguredClassifier(fetchImpl: FetchLike = fetch) {
  return createAnthropicClassifier(fetchImpl);
}
