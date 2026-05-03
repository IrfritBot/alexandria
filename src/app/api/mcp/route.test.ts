import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";
import { inngest } from "../../../lib/inngest/client";
import { createSupabaseServiceRoleClient } from "../../../lib/supabase/service-role";

vi.mock("server-only", () => ({}));

vi.mock("../../../lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

vi.mock("../../../lib/inngest/client", () => ({
  inngest: {
    send: vi.fn(async () => ({ ids: ["event-1"] })),
  },
}));

const getNotImplementedPayload = {
  ok: false,
  service: "alexandria",
  surface: "mcp",
  status: "not_implemented",
  message: "MCP GET discovery is not implemented yet.",
};

const unsupportedPayload = {
  ok: false,
  service: "alexandria",
  surface: "mcp",
  status: "not_implemented",
  message: "MCP method is not implemented.",
};

const unauthorizedPayload = {
  ok: false,
  service: "alexandria",
  surface: "mcp",
  error: "invalid_mcp_key",
};

const validApiKey = `alex_abcdef12_${"0".repeat(32)}`;

const validMemorySaveCall = {
  method: "memory_save",
  params: {
    content: "Remember the deployment freeze starts Friday.",
  },
};

function makeRequest(apiKey: string | null = validApiKey, body?: unknown) {
  const headers = new Headers();

  if (apiKey) {
    headers.set("authorization", `Bearer ${apiKey}`);
  }

  if (body !== undefined) {
    headers.set("content-type", "application/json");
  }

  return new Request("https://alexandria.test/api/mcp", {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
    method: "POST",
  });
}

function mockMcpRpc({
  saveData = [
    {
      memory_id: "memory-1",
      status: "processing",
    },
  ],
  saveError = null,
  verifyData = [
    {
      id: "mcp-key-1",
      workspace_id: "workspace-1",
    },
  ],
}: {
  saveData?: unknown[];
  saveError?: { code?: string; message?: string } | null;
  verifyData?: unknown[];
} = {}) {
  const rpc = vi.fn(async (functionName: string) => {
    if (functionName === "verify_mcp_api_key") {
      return {
        data: verifyData,
        error: null,
      };
    }

    if (functionName === "save_mcp_memory") {
      return {
        data: saveData,
        error: saveError,
      };
    }

    return {
      data: null,
      error: {
        message: `unexpected rpc: ${functionName}`,
      },
    };
  });

  vi.mocked(createSupabaseServiceRoleClient).mockReturnValue({
    rpc,
  } as never);

  return rpc;
}

async function expectNotImplementedResponse(response: Response) {
  await expect(response.json()).resolves.toEqual(getNotImplementedPayload);
  expect(response.status).toBe(501);
}

async function expectUnauthorizedResponse(response: Response) {
  await expect(response.json()).resolves.toEqual(unauthorizedPayload);
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toBe("Bearer");
}

describe("mcp route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the stable 501 contract for authenticated GET", async () => {
    mockMcpRpc();

    await expectNotImplementedResponse(await GET(makeRequest()));
  });

  it("saves a memory, writes through the RPC, and enqueues processing", async () => {
    const rpc = mockMcpRpc();

    const response = await POST(
      makeRequest(validApiKey, {
        method: "memory_save",
        params: {
          content: "  ## Decision\nShip the smaller first pass.  ",
          tags: [" Product Updates ", "#Policy", "product_updates"],
        },
      }),
    );

    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "alexandria",
      surface: "mcp",
      method: "memory_save",
      memory_id: "memory-1",
      status: "processing",
      message: "Memory accepted for processing.",
    });
    expect(response.status).toBe(202);
    expect(rpc).toHaveBeenCalledWith("verify_mcp_api_key", {
      p_key_prefix: "abcdef12",
      p_presented_key: validApiKey,
    });
    expect(rpc).toHaveBeenCalledWith("save_mcp_memory", {
      p_content: "## Decision\nShip the smaller first pass.",
      p_mcp_key_id: "mcp-key-1",
      p_tags: ["product-updates", "policy"],
      p_workspace_id: "workspace-1",
    });
    expect(inngest.send).toHaveBeenCalledWith({
      data: {
        mcp_key_id: "mcp-key-1",
        memory_id: "memory-1",
        tags: ["product-updates", "policy"],
        workspace_id: "workspace-1",
      },
      name: "memory/process.requested",
    });
  });

  it("keeps the memory save scoped to the validated session workspace", async () => {
    const rpc = mockMcpRpc();

    const response = await POST(
      makeRequest(validApiKey, {
        method: "memory_save",
        params: {
          content: "Caller supplied workspace ids are ignored.",
          workspaceId: "workspace-other",
          workspace_id: "workspace-other",
        },
      }),
    );

    expect(response.status).toBe(202);
    expect(rpc).toHaveBeenCalledWith("save_mcp_memory", {
      p_content: "Caller supplied workspace ids are ignored.",
      p_mcp_key_id: "mcp-key-1",
      p_tags: [],
      p_workspace_id: "workspace-1",
    });
  });

  it("accepts the minimal tools/call shape for memory_save", async () => {
    const rpc = mockMcpRpc();

    const response = await POST(
      makeRequest(validApiKey, {
        method: "tools/call",
        params: {
          arguments: {
            content: "Save through a tools/call envelope.",
          },
          name: "memory_save",
        },
      }),
    );

    expect(response.status).toBe(202);
    expect(rpc).toHaveBeenCalledWith("save_mcp_memory", {
      p_content: "Save through a tools/call envelope.",
      p_mcp_key_id: "mcp-key-1",
      p_tags: [],
      p_workspace_id: "workspace-1",
    });
  });

  it("returns 501 for unsupported authenticated MCP methods", async () => {
    const rpc = mockMcpRpc();

    const response = await POST(
      makeRequest(validApiKey, {
        method: "tools/list",
      }),
    );

    await expect(response.json()).resolves.toEqual(unsupportedPayload);
    expect(response.status).toBe(501);
    expect(rpc).toHaveBeenCalledWith("verify_mcp_api_key", {
      p_key_prefix: "abcdef12",
      p_presented_key: validApiKey,
    });
    expect(rpc).not.toHaveBeenCalledWith(
      "save_mcp_memory",
      expect.anything(),
    );
  });

  it.each([
    [
      "missing content",
      {
        method: "memory_save",
        params: {
          tags: ["policy"],
        },
      },
      "content",
    ],
    [
      "oversized content",
      {
        method: "memory_save",
        params: {
          content: "x".repeat(8193),
        },
      },
      "content",
    ],
    [
      "non-array tags",
      {
        method: "memory_save",
        params: {
          content: "Remember this.",
          tags: "policy",
        },
      },
      "tags",
    ],
    [
      "non-string tag",
      {
        method: "memory_save",
        params: {
          content: "Remember this.",
          tags: ["policy", 1],
        },
      },
      "tags",
    ],
  ])("returns 400 for %s", async (_caseName, body, field) => {
    const rpc = mockMcpRpc();

    const response = await POST(makeRequest(validApiKey, body));

    await expect(response.json()).resolves.toEqual({
      ok: false,
      service: "alexandria",
      surface: "mcp",
      error: "invalid_input",
      field,
    });
    expect(response.status).toBe(400);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalledWith(
      "save_mcp_memory",
      expect.anything(),
    );
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it("rejects missing and malformed Bearer keys before verification", async () => {
    await expectUnauthorizedResponse(await POST(makeRequest(null)));
    await expectUnauthorizedResponse(await POST(makeRequest("not-a-key")));
    expect(createSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });

  it("rejects invalid or revoked keys", async () => {
    mockMcpRpc({ verifyData: [] });

    await expectUnauthorizedResponse(
      await POST(makeRequest(validApiKey, validMemorySaveCall)),
    );
  });
});
