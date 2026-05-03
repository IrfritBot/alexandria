import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      return filesUnder(path);
    }

    if (path.includes(".test.")) {
      return [];
    }

    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}

describe("governance shell security posture", () => {
  it("does not import service-role Supabase clients in web workspace routes", () => {
    const files = filesUnder(join(process.cwd(), "src/app/workspaces"));

    for (const file of files) {
      const source = readFileSync(file, "utf8");

      expect(source).not.toContain("service-role");
      expect(source).not.toContain("createSupabaseServiceRoleClient");
      expect(source).not.toContain("api-key-validation");
    }
  });

  it("uses service-role MCP key validation only from the MCP API route", () => {
    const appFiles = filesUnder(join(process.cwd(), "src/app"));
    const validationImporters = appFiles.filter((file) =>
      readFileSync(file, "utf8").includes("api-key-validation"),
    );

    expect(validationImporters).toEqual([
      join(process.cwd(), "src/app/api/mcp/route.ts"),
    ]);
  });
});
