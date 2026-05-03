import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import McpKeysPage from "./page";

vi.mock("server-only", () => ({}));

vi.mock("../../../../lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

type SupabaseInput = {
  keyRows?: Record<string, unknown>[];
  role: "admin" | "member";
};

function mockSupabase({ keyRows = [], role }: SupabaseInput) {
  const tableCalls: string[] = [];
  const getUser = vi.fn(async () => ({
    data: {
      user: {
        email: "person@example.com",
        id: "auth-user-1",
      },
    },
    error: null,
  }));
  const from = vi.fn((table: string) => {
    tableCalls.push(table);
    const builder = {
      eq: vi.fn(() => builder),
      is: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => {
        if (table === "workspaces") {
          return {
            data: {
              context_description: "Shared workspace context for tests.",
              created_at: "2026-05-01T09:00:00.000Z",
              id: "workspace-1",
              name: "Alexandria Team",
              slug: "alexandria-team",
              tier: "basic",
            },
            error: null,
          };
        }

        if (table === "profiles") {
          return {
            data: {
              display_name: "Person",
              id: "profile-1",
            },
            error: null,
          };
        }

        return {
          data: {
            joined_at: "2026-05-01T10:00:00.000Z",
            role,
          },
          error: null,
        };
      }),
      order: vi.fn(async () => ({
        data: keyRows,
        error: null,
      })),
      select: vi.fn(() => builder),
    };

    return builder;
  });

  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser,
    },
    from,
  } as never);

  return {
    from,
    tableCalls,
  };
}

describe("mcp keys page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows key management and safe key metadata for admins", async () => {
    const { tableCalls } = mockSupabase({
      keyRows: [
        {
          created_at: "2026-05-01T10:00:00.000Z",
          id: "key-1",
          key_prefix: "abc123ef",
          last_used_at: null,
          name: "Build bot",
          revoked_at: null,
          workspace_id: "workspace-1",
        },
      ],
      role: "admin",
    });

    const html = renderToString(
      await McpKeysPage({
        params: Promise.resolve({ slug: "alexandria-team" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(tableCalls).toContain("mcp_keys");
    expect(html).toContain("Create key");
    expect(html).toContain("Build bot");
    expect(html).toContain("abc123ef");
    expect(html).not.toContain("key_hash");
  });

  it("does not query or render MCP keys for members", async () => {
    const { tableCalls } = mockSupabase({
      keyRows: [
        {
          id: "key-1",
          key_hash: "never-render",
          name: "Hidden key",
        },
      ],
      role: "member",
    });

    const html = renderToString(
      await McpKeysPage({
        params: Promise.resolve({ slug: "alexandria-team" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(tableCalls).not.toContain("mcp_keys");
    expect(html).toContain("workspace admins only");
    expect(html).not.toContain("Hidden key");
    expect(html).not.toContain("never-render");
  });
});
