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
});
