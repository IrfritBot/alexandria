import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  isValidPkceVerifier,
  randomToken,
  sha256Token,
  verifyPkce,
} from "./crypto";

describe("OAuth crypto helpers", () => {
  it("generates base64url tokens and SHA-256 hashes", () => {
    const token = randomToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).toHaveLength(43);
    expect(sha256Token("token")).toBe(
      createHash("sha256").update("token").digest("hex"),
    );
  });

  it("validates S256 PKCE verifiers", () => {
    const verifier = "a".repeat(43);
    const challenge = createHash("sha256")
      .update(verifier)
      .digest("base64url");

    expect(isValidPkceVerifier(verifier)).toBe(true);
    expect(verifyPkce({ challenge, method: "S256", verifier })).toBe(true);
    expect(
      verifyPkce({ challenge: "wrong", method: "S256", verifier }),
    ).toBe(false);
  });

  it("rejects unsafe PKCE verifier values", () => {
    const challenge = createHash("sha256")
      .update("short")
      .digest("base64url");

    expect(isValidPkceVerifier("short")).toBe(false);
    expect(
      verifyPkce({ challenge, method: "S256", verifier: "short" }),
    ).toBe(false);
    expect(
      verifyPkce({
        challenge,
        method: "S256",
        verifier: `${"a".repeat(42)}!`,
      }),
    ).toBe(false);
  });
});
