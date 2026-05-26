import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkspaceShell } from "./[slug]/_components/workspace-shell";

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

  it("includes member-visible setup navigation", () => {
    const html = renderToString(
      createElement(
        WorkspaceShell,
        {
          active: "setup",
          context: {
            membership: {
              joinedAt: "2026-05-01T10:00:00.000Z",
              role: "member",
            },
            profile: {
              displayName: "Person",
              id: "profile-1",
            },
            user: {
              email: "person@example.com",
              id: "auth-user-1",
            },
            workspace: {
              contextDescription: "Shared context",
              createdAt: "2026-05-01T09:00:00.000Z",
              id: "workspace-1",
              name: "Alexandria Team",
              slug: "alexandria-team",
              tier: "basic",
            },
          },
        } as Parameters<typeof WorkspaceShell>[0],
        "Setup body",
      ),
    );

    expect(html).toContain('href="/workspaces/alexandria-team/setup"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Setup");
  });
});
