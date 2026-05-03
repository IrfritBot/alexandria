import { afterEach, describe, expect, it, vi } from "vitest";

import { loadWorkspaceContext } from "./workspace-context";

vi.mock("server-only", () => ({}));

type TableName = "profiles" | "workspace_members" | "workspaces";

function makeSupabase(input: {
  membership?: Record<string, unknown> | null;
  profile?: Record<string, unknown> | null;
  user?: { email?: string | null; id: string } | null;
  workspace?: Record<string, unknown> | null;
}) {
  const getUser = vi.fn(async () => ({
    data: {
      user:
        input.user === undefined
          ? { email: "person@example.com", id: "auth-user-1" }
          : input.user,
    },
    error: null,
  }));
  const tableCalls: string[] = [];
  const tableData: Record<TableName, Record<string, unknown> | null> = {
    profiles:
      input.profile === undefined
        ? {
            display_name: "Person",
            id: "profile-1",
          }
        : input.profile,
    workspace_members:
      input.membership === undefined
        ? {
            joined_at: "2026-05-01T10:00:00.000Z",
            role: "admin",
          }
        : input.membership,
    workspaces:
      input.workspace === undefined
        ? {
            context_description: "Shared workspace context for tests.",
            created_at: "2026-05-01T09:00:00.000Z",
            id: "workspace-1",
            name: "Alexandria Team",
            slug: "alexandria-team",
            tier: "basic",
          }
        : input.workspace,
  };
  const from = vi.fn((table: TableName) => {
    tableCalls.push(table);
    const builder = {
      eq: vi.fn(() => builder),
      is: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => ({
        data: tableData[table],
        error: null,
      })),
      select: vi.fn(() => builder),
    };

    return builder;
  });

  return {
    auth: {
      getUser,
    },
    from,
    tableCalls,
  };
}

describe("workspace context", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not query tenant tables for signed-out callers", async () => {
    const supabase = makeSupabase({ user: null });

    const result = await loadWorkspaceContext(
      { slug: "alexandria-team" },
      supabase as never,
    );

    expect(result).toEqual({ ok: false, reason: "unauthenticated" });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("loads workspace, caller profile, and exact membership role", async () => {
    const supabase = makeSupabase({});

    const result = await loadWorkspaceContext(
      { slug: "alexandria-team" },
      supabase as never,
    );

    expect(result).toMatchObject({
      context: {
        membership: {
          role: "admin",
        },
        profile: {
          id: "profile-1",
        },
        workspace: {
          id: "workspace-1",
          slug: "alexandria-team",
        },
      },
      ok: true,
    });
    expect(supabase.tableCalls).toEqual([
      "workspaces",
      "profiles",
      "workspace_members",
    ]);
  });

  it("rejects a visible workspace without caller membership", async () => {
    const supabase = makeSupabase({ membership: null });

    const result = await loadWorkspaceContext(
      { slug: "alexandria-team" },
      supabase as never,
    );

    expect(result).toEqual({ ok: false, reason: "not_member" });
  });
});
