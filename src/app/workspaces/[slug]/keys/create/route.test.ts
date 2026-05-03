import { afterEach, describe, expect, it, vi } from "vitest";

import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { POST } from "./route";

vi.mock("server-only", () => ({}));

vi.mock("../../../../../lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

function makeRequest(name: string) {
  return new Request(
    "https://alexandria.test/workspaces/alexandria-team/keys/create",
    {
      body: new URLSearchParams({ name }),
      headers: {
        origin: "https://alexandria.test",
      },
      method: "POST",
    },
  );
}

function makeCrossOriginRequest(name: string) {
  return new Request(
    "https://alexandria.test/workspaces/alexandria-team/keys/create",
    {
      body: new URLSearchParams({ name }),
      headers: {
        origin: "https://example.invalid",
      },
      method: "POST",
    },
  );
}

function mockSupabase(role: "admin" | "member") {
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
      select: vi.fn(() => builder),
    };

    return builder;
  });
  const rpc = vi.fn(async (functionName: string, args: Record<string, string>) => {
    if (functionName !== "issue_mcp_key") {
      return {
        data: null,
        error: {
          message: "unexpected rpc",
        },
      };
    }

    return {
      data: [
        {
          created_at: "2026-05-01T10:00:00.000Z",
          id: "key-1",
          key_prefix: args.p_key_prefix,
          name: args.p_name,
          workspace_id: args.p_workspace_id,
        },
      ],
      error: null,
    };
  });

  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser,
    },
    from,
    rpc,
  } as never);

  return {
    rpc,
  };
}

describe("create MCP key route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("issues a key for workspace admins and returns the one-time value", async () => {
    const { rpc } = mockSupabase("admin");

    const response = await POST(makeRequest("Build bot"), {
      params: Promise.resolve({ slug: "alexandria-team" }),
    });
    const html = await response.text();
    const [, args] = rpc.mock.calls[0];

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "issue_mcp_key",
      expect.objectContaining({
        p_name: "Build bot",
        p_workspace_id: "workspace-1",
      }),
    );
    expect(args.p_presented_key).toMatch(/^alex_[a-f0-9]{8}_[a-f0-9]{32}$/);
    expect(html).toContain("MCP key created");
    expect(html).toContain("This value is shown once");
    expect(html).not.toContain("key_hash");
  });

  it("rejects member callers before issuing a key", async () => {
    const { rpc } = mockSupabase("member");

    const response = await POST(makeRequest("Build bot"), {
      params: Promise.resolve({ slug: "alexandria-team" }),
    });

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    await expect(response.text()).resolves.toContain("Admin access required");
  });

  it("rejects cross-origin key creation before loading workspace state", async () => {
    const { rpc } = mockSupabase("admin");
    vi.mocked(createSupabaseServerClient).mockClear();

    const response = await POST(makeCrossOriginRequest("Build bot"), {
      params: Promise.resolve({ slug: "alexandria-team" }),
    });

    expect(response.status).toBe(403);
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
