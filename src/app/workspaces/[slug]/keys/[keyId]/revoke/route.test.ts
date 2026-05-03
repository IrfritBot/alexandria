import { afterEach, describe, expect, it, vi } from "vitest";

import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { POST } from "./route";

vi.mock("server-only", () => ({}));

vi.mock("../../../../../../lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

function makeRequest() {
  return new Request(
    "https://alexandria.test/workspaces/alexandria-team/keys/key-1/revoke",
    {
      headers: {
        origin: "https://alexandria.test",
      },
      method: "POST",
    },
  );
}

function makeCrossOriginRequest() {
  return new Request(
    "https://alexandria.test/workspaces/alexandria-team/keys/key-1/revoke",
    {
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
  const rpc = vi.fn(async (functionName: string) => {
    if (functionName !== "revoke_mcp_key") {
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
          id: "key-1",
          key_prefix: "abc123ef",
          name: "Build bot",
          revoked_at: "2026-05-01T11:00:00.000Z",
          workspace_id: "workspace-1",
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

describe("revoke MCP key route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("revokes a key for workspace admins", async () => {
    const { rpc } = mockSupabase("admin");

    const response = await POST(makeRequest(), {
      params: Promise.resolve({
        keyId: "key-1",
        slug: "alexandria-team",
      }),
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://alexandria.test/workspaces/alexandria-team/keys?revoked=1",
    );
    expect(rpc).toHaveBeenCalledWith("revoke_mcp_key", {
      p_mcp_key_id: "key-1",
      p_workspace_id: "workspace-1",
    });
  });

  it("rejects member callers before revocation", async () => {
    const { rpc } = mockSupabase("member");

    const response = await POST(makeRequest(), {
      params: Promise.resolve({
        keyId: "key-1",
        slug: "alexandria-team",
      }),
    });

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects cross-origin revocation before loading workspace state", async () => {
    const { rpc } = mockSupabase("admin");
    vi.mocked(createSupabaseServerClient).mockClear();

    const response = await POST(makeCrossOriginRequest(), {
      params: Promise.resolve({
        keyId: "key-1",
        slug: "alexandria-team",
      }),
    });

    expect(response.status).toBe(403);
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
