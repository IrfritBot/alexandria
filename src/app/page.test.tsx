import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function pageSource() {
  return readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");
}

describe("home page", () => {
  it("contains the signed-out render path", () => {
    const source = pageSource();

    expect(source).toContain('href="/login"');
    expect(source).toContain("Sign in");
    expect(source).toContain("Shared team memory");
  });

  it("contains the signed-in render path", () => {
    const source = pageSource();

    expect(source).toContain("user.email");
    expect(source).toContain('href="/workspaces/new"');
    expect(source).toContain("Create workspace");
    expect(source).toContain("Your workspaces");
  });
});
