import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

export type PkceMethod = "S256" | "plain";

export function randomToken(byteLength = 32) {
  if (!Number.isInteger(byteLength) || byteLength < 16) {
    throw new Error("OAuth token byte length must be at least 16.");
  }

  return randomBytes(byteLength).toString("base64url");
}

export function sha256Token(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function isValidCodeVerifier(verifier: string) {
  return CODE_VERIFIER_PATTERN.test(verifier);
}

export const isValidPkceVerifier = isValidCodeVerifier;

function sha256Base64Url(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyPkce(input: {
  challenge: string;
  method: string;
  verifier: string;
}) {
  if (!isValidCodeVerifier(input.verifier) || input.challenge.length === 0) {
    return false;
  }

  if (input.method === "S256") {
    return safeEqual(sha256Base64Url(input.verifier), input.challenge);
  }

  if (input.method === "plain") {
    return safeEqual(input.verifier, input.challenge);
  }

  return false;
}
