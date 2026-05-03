import { describe, expect, it } from "vitest";

import { validateMutationOrigin } from "./post-origin";

function requestWithHeaders(headers: HeadersInit) {
  return new Request("https://alexandria.test/workspaces/demo/keys/create", {
    headers,
    method: "POST",
  });
}

describe("mutation origin validation", () => {
  it("accepts same-origin Origin headers", () => {
    expect(
      validateMutationOrigin(
        requestWithHeaders({ origin: "https://alexandria.test" }),
      ),
    ).toEqual({ ok: true });
  });

  it("accepts same-origin Referer when Origin is unavailable", () => {
    expect(
      validateMutationOrigin(
        requestWithHeaders({
          referer: "https://alexandria.test/workspaces/demo/keys",
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("rejects cross-origin mutation attempts", () => {
    expect(
      validateMutationOrigin(
        requestWithHeaders({ origin: "https://example.invalid" }),
      ),
    ).toEqual({ ok: false, reason: "cross_origin" });
  });

  it("rejects mutations with no browser origin signal", () => {
    expect(validateMutationOrigin(requestWithHeaders({}))).toEqual({
      ok: false,
      reason: "missing_origin",
    });
  });
});
