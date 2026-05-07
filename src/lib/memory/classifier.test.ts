import { describe, expect, it } from "vitest";

import {
  buildClassifierPrompt,
  CLASSIFIER_PROMPT_VERSION,
  createDeterministicClassifier,
  parseClassifierJson,
} from "./classifier";

describe("classifier", () => {
  it("keeps the v1 prompt versioned and strict about JSON output", () => {
    const prompt = buildClassifierPrompt("We do not sell to crypto clients.");

    expect(CLASSIFIER_PROMPT_VERSION).toBe("classifier/v1");
    expect(prompt).toContain("strict JSON");
    expect(prompt).toContain('"policy" | "fact" | "judgment"');
    expect(prompt).toContain("We do not sell to crypto clients.");
  });

  it("parses valid classifier JSON and clamps confidence", () => {
    expect(
      parseClassifierJson(
        JSON.stringify({
          confidence: 1.4,
          kind: "fact",
          suggested_tags: ["client/ashley"],
        }),
      ),
    ).toEqual({
      confidence: 1,
      kind: "fact",
      suggestedTags: ["client/ashley"],
    });
  });

  it("parses classifier JSON wrapped in a markdown code fence", () => {
    expect(
      parseClassifierJson(`\`\`\`json
{
  "kind": "policy",
  "confidence": 0.82,
  "suggested_tags": ["policy/refunds"]
}
\`\`\``),
    ).toEqual({
      confidence: 0.82,
      kind: "policy",
      suggestedTags: ["policy/refunds"],
    });
  });

  it("does not extract JSON from prose around a markdown code fence", () => {
    expect(() =>
      parseClassifierJson(`Here is the classification:

\`\`\`json
{
  "kind": "policy",
  "confidence": 0.82,
  "suggested_tags": ["policy/refunds"]
}
\`\`\``),
    ).toThrow("classifier returned invalid JSON");
  });

  it("provides a deterministic classifier seam when provider env is absent", async () => {
    const classifier = createDeterministicClassifier();

    await expect(
      classifier({
        content: "We do not sell to crypto clients.",
        tier: "basic",
      }),
    ).resolves.toMatchObject({
      kind: "policy",
      model: "deterministic-classifier-v1",
      provider: "deterministic",
    });
  });
});
