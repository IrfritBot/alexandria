import { describe, expect, it } from "vitest";

import { getSafeNext } from "./safe-next";

describe("getSafeNext", () => {
  it("allows valid relative paths", () => {
    expect(getSafeNext("/workspaces/new")).toBe("/workspaces/new");
    expect(getSafeNext("/settings?tab=profile")).toBe(
      "/settings?tab=profile",
    );
  });

  it("falls back to the root path by default", () => {
    expect(getSafeNext(null)).toBe("/");
    expect(getSafeNext("")).toBe("/");
  });

  it("rejects protocol injection", () => {
    expect(getSafeNext("https://example.com")).toBe("/");
    expect(getSafeNext("/redirect?to=https://example.com")).toBe("/");
  });

  it("rejects double-slash paths", () => {
    expect(getSafeNext("//example.com")).toBe("/");
    expect(getSafeNext("/workspaces//new")).toBe("/");
  });

  it("rejects backslashes", () => {
    expect(getSafeNext("/\\example.com")).toBe("/");
    expect(getSafeNext("/workspaces\\new")).toBe("/");
  });

  it("rejects whitespace", () => {
    expect(getSafeNext("/workspaces/new profile")).toBe("/");
    expect(getSafeNext("/workspaces/new\nprofile")).toBe("/");
  });

  it("rejects API paths", () => {
    expect(getSafeNext("/api/workspaces")).toBe("/");
    expect(getSafeNext("/api")).toBe("/");
  });

  it("rejects auth paths", () => {
    expect(getSafeNext("/auth/callback")).toBe("/");
    expect(getSafeNext("/auth")).toBe("/");
  });

  it("allows only OAuth authorize continuations with validated redirect URIs", () => {
    const authorizeNext =
      "/oauth/authorize?response_type=code&client_id=alex_client_1&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&code_challenge=abc&code_challenge_method=S256";

    expect(getSafeNext(authorizeNext)).toBe(
      "/oauth/authorize?response_type=code&client_id=alex_client_1&redirect_uri=https://client.example/callback&code_challenge=abc&code_challenge_method=S256",
    );
    expect(
      getSafeNext(
        "/oauth/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A53682%2Fcallback",
      ),
    ).toBe("/oauth/authorize?redirect_uri=http://localhost:53682/callback");
  });

  it("preserves OAuth authorize continuations with valid scope values", () => {
    expect(
      getSafeNext(
        "/oauth/authorize?response_type=code&client_id=alex_client_1&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&scope=memory%3Aread%20memory%3Awrite&code_challenge=abc&code_challenge_method=S256",
      ),
    ).toBe(
      "/oauth/authorize?response_type=code&client_id=alex_client_1&redirect_uri=https://client.example/callback&scope=memory:read memory:write&code_challenge=abc&code_challenge_method=S256",
    );
    expect(
      getSafeNext(
        "/oauth/authorize?response_type=code&client_id=alex_client_1&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&scope=memory%3Aread+memory%3Awrite&code_challenge=abc&code_challenge_method=S256",
      ),
    ).toBe(
      "/oauth/authorize?response_type=code&client_id=alex_client_1&redirect_uri=https://client.example/callback&scope=memory:read+memory:write&code_challenge=abc&code_challenge_method=S256",
    );
  });

  it("keeps non-authorize OAuth paths and unsafe OAuth queries rejected", () => {
    expect(
      getSafeNext(
        "/oauth/token?redirect_uri=https%3A%2F%2Fclient.example%2Fcallback",
      ),
    ).toBe("/");
    expect(getSafeNext("/oauth/authorize?x=https%3A%2F%2Fevil.example")).toBe(
      "/",
    );
    expect(getSafeNext("/oauth/authorize?x=%2F%2Fevil.example")).toBe("/");
    expect(
      getSafeNext("/oauth/authorize?scope=memory%3Aread%20admin%3Awrite"),
    ).toBe("/");
    expect(getSafeNext("/oauth/authorize?redirect_uri=javascript%3Aalert(1)")).toBe(
      "/",
    );
    expect(getSafeNext("//evil.example/oauth/authorize")).toBe("/");
  });
});
