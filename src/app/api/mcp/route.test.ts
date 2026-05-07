import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";
import { inngest } from "../../../lib/inngest/client";
import { createSupabaseMcpExecutorClient } from "../../../lib/supabase/mcp-executor";
import { createSupabaseServiceRoleClient } from "../../../lib/supabase/service-role";
import {
  MCP_TOOLS,
  MEMORY_GET_DESCRIPTION,
  MEMORY_RECALL_RECENT_DESCRIPTION,
  MEMORY_SAVE_DESCRIPTION,
  MEMORY_SEARCH_DESCRIPTION,
} from "../../../lib/mcp/tool-descriptions";

vi.mock("server-only", () => ({}));

vi.mock("../../../lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

vi.mock("../../../lib/supabase/mcp-executor", () => ({
  createSupabaseMcpExecutorClient: vi.fn(),
}));

vi.mock("../../../lib/inngest/client", () => ({
  inngest: {
    send: vi.fn(async () => ({ ids: ["event-1"] })),
  },
}));

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
const memoryId = "11111111-1111-4111-8111-111111111111";
const authorProfileId = "22222222-2222-4222-8222-222222222222";

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

function makeGetRequest(apiKey: string | null = validApiKey) {
  const headers = new Headers();

  if (apiKey) {
    headers.set("authorization", `Bearer ${apiKey}`);
  }

  return new Request("https://alexandria.test/api/mcp", {
    headers,
    method: "GET",
  });
}

function mockMcpRpc({
  getData = [
    {
      author_label: "MCP key",
      content: "Ashley Stambouli uses Shopify.",
      created_at: "2026-05-03T12:05:00.000Z",
      kind: "fact",
      memory_id: memoryId,
      source: "mcp",
      source_client: null,
      superseded_by_memory_id: null,
      tags: ["client/ashley-stambouli"],
      updated_at: "2026-05-03T12:06:00.000Z",
    },
  ],
  recallData = [
    {
      author_label: "MCP key",
      content: "The deployment freeze starts Friday.",
      created_at: "2026-05-03T12:00:00.000Z",
      kind: "policy",
      memory_id: memoryId,
      source: "mcp",
      source_client: "Claude Desktop",
      tags: ["policy"],
    },
  ],
  saveData = [
    {
      memory_id: "memory-1",
      status: "processing",
    },
  ],
  saveError = null,
  searchData = [
    {
      author_label: "MCP key",
      content: "Ashley Stambouli uses Shopify.",
      created_at: "2026-05-03T12:00:00.000Z",
      kind: "fact",
      memory_id: memoryId,
      relevance_score: 0.88,
      source: "mcp",
      source_client: "Claude Desktop",
      tags: ["client/ashley-stambouli"],
      total_count: 1,
    },
  ],
  verifyData = [
    {
      id: "mcp-key-1",
      workspace_id: "workspace-1",
    },
  ],
  oauthVerifyData = [
    {
      client_id: "client-1",
      mcp_key_id: "oauth-mcp-key-1",
      profile_id: "profile-1",
      scopes: ["memory:read", "memory:write"],
      workspace_id: "workspace-1",
    },
  ],
}: {
  getData?: unknown[];
  recallData?: unknown[];
  saveData?: unknown[];
  saveError?: { code?: string; message?: string } | null;
  searchData?: unknown[];
  verifyData?: unknown[];
  oauthVerifyData?: unknown[];
} = {}) {
  const verifyRpc = vi.fn(async (functionName: string) => {
    if (functionName === "verify_mcp_api_key") {
      return {
        data: verifyData,
        error: null,
      };
    }

    if (functionName === "verify_oauth_access_token") {
      return {
        data: oauthVerifyData,
        error: null,
      };
    }

    return {
      data: null,
      error: {
        message: `unexpected service-role rpc: ${functionName}`,
      },
    };
  });
  const executorRpc = vi.fn(async (functionName: string) => {
    if (functionName === "save_mcp_memory") {
      return {
        data: saveData,
        error: saveError,
      };
    }

    if (functionName === "search_mcp_memories") {
      return {
        data: searchData,
        error: null,
      };
    }

    if (functionName === "recall_recent_mcp_memories") {
      return {
        data: recallData,
        error: null,
      };
    }

    if (functionName === "get_mcp_memory") {
      return {
        data: getData,
        error: null,
      };
    }

    return {
      data: null,
      error: {
        message: `unexpected executor rpc: ${functionName}`,
      },
    };
  });

  vi.mocked(createSupabaseServiceRoleClient).mockReturnValue({
    rpc: verifyRpc,
  } as never);
  vi.mocked(createSupabaseMcpExecutorClient).mockReturnValue({
    rpc: executorRpc,
  } as never);

  return { executorRpc, verifyRpc };
}

async function expectUnauthorizedResponse(response: Response) {
  await expect(response.json()).resolves.toEqual(unauthorizedPayload);
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toBe(
    'Bearer resource_metadata="https://alexandria.test/.well-known/oauth-protected-resource"',
  );
}

describe("mcp route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the locked v1 tool catalog for authenticated GET", async () => {
    mockMcpRpc();

    const response = await GET(makeGetRequest());

    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "alexandria",
      surface: "mcp",
      tools: MCP_TOOLS,
    });
    expect(response.status).toBe(200);
    expect(MCP_TOOLS.map((tool) => tool.name)).toEqual([
      "memory_save",
      "memory_search",
      "memory_recall_recent",
      "memory_get",
    ]);
    expect(MCP_TOOLS[0]?.description).toBe(MEMORY_SAVE_DESCRIPTION);
    expect(MCP_TOOLS[1]?.description).toBe(MEMORY_SEARCH_DESCRIPTION);
    expect(MCP_TOOLS[2]?.description).toBe(MEMORY_RECALL_RECENT_DESCRIPTION);
    expect(MCP_TOOLS[3]?.description).toBe(MEMORY_GET_DESCRIPTION);
  });

  it("returns the same tool catalog through tools/list", async () => {
    const { executorRpc, verifyRpc } = mockMcpRpc();

    const response = await POST(
      makeRequest(validApiKey, {
        method: "tools/list",
      }),
    );

    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "alexandria",
      surface: "mcp",
      tools: MCP_TOOLS,
    });
    expect(verifyRpc).toHaveBeenCalledWith("verify_mcp_api_key", {
      p_key_prefix: "abcdef12",
      p_presented_key: validApiKey,
    });
    expect(executorRpc).not.toHaveBeenCalled();
  });

  it("saves a memory, writes through the RPC, and enqueues processing", async () => {
    const { executorRpc, verifyRpc } = mockMcpRpc();

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
    expect(verifyRpc).toHaveBeenCalledWith("verify_mcp_api_key", {
      p_key_prefix: "abcdef12",
      p_presented_key: validApiKey,
    });
    expect(verifyRpc).not.toHaveBeenCalledWith(
      "save_mcp_memory",
      expect.anything(),
    );
    expect(executorRpc).toHaveBeenCalledWith("save_mcp_memory", {
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
    const { executorRpc } = mockMcpRpc();

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
    expect(executorRpc).toHaveBeenCalledWith("save_mcp_memory", {
      p_content: "Caller supplied workspace ids are ignored.",
      p_mcp_key_id: "mcp-key-1",
      p_tags: [],
      p_workspace_id: "workspace-1",
    });
  });

  it("accepts the minimal tools/call shape for memory_save", async () => {
    const { executorRpc } = mockMcpRpc();

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
    expect(executorRpc).toHaveBeenCalledWith("save_mcp_memory", {
      p_content: "Save through a tools/call envelope.",
      p_mcp_key_id: "mcp-key-1",
      p_tags: [],
      p_workspace_id: "workspace-1",
    });
  });

  it("dispatches memory_search through the validated MCP session", async () => {
    const { executorRpc } = mockMcpRpc();

    const response = await POST(
      makeRequest(validApiKey, {
        method: "tools/call",
        params: {
          arguments: {
            kind: "fact",
            limit: 500,
            query: "Ashley Stambouli Shopify",
            tags: [" Client/Ashley Stambouli "],
          },
          name: "memory_search",
        },
      }),
    );

    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "alexandria",
      surface: "mcp",
      method: "memory_search",
      memories: [
        {
          author_label: "MCP key",
          content: "Ashley Stambouli uses Shopify.",
          created_at: "2026-05-03T12:00:00.000Z",
          kind: "fact",
          memory_id: memoryId,
          relevance_score: 0.88,
          source: "mcp",
          source_client: "Claude Desktop",
          tags: ["client/ashley-stambouli"],
        },
      ],
      total: 1,
    });
    expect(executorRpc).toHaveBeenCalledWith("search_mcp_memories", {
      p_kind: "fact",
      p_limit: 50,
      p_mcp_key_id: "mcp-key-1",
      p_query: "Ashley Stambouli Shopify",
      p_tags: ["client/ashley-stambouli"],
      p_workspace_id: "workspace-1",
    });
  });

  it("accepts OAuth bearer tokens for scoped MCP reads", async () => {
    const { executorRpc, verifyRpc } = mockMcpRpc();
    const oauthToken = `alex_oat_${"A".repeat(43)}`;

    const response = await POST(
      makeRequest(oauthToken, {
        method: "memory_search",
        params: {
          query: "Ashley",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(verifyRpc).toHaveBeenCalledWith("verify_oauth_access_token", {
      p_token_hash: expect.any(String),
    });
    expect(executorRpc).toHaveBeenCalledWith("search_mcp_memories", {
      p_kind: null,
      p_limit: 10,
      p_mcp_key_id: "oauth-mcp-key-1",
      p_query: "Ashley",
      p_tags: [],
      p_workspace_id: "workspace-1",
    });
  });

  it("rejects OAuth bearer tokens without the required MCP scope", async () => {
    const { executorRpc } = mockMcpRpc({
      oauthVerifyData: [
        {
          client_id: "client-1",
          mcp_key_id: "oauth-mcp-key-1",
          profile_id: "profile-1",
          scopes: ["memory:read"],
          workspace_id: "workspace-1",
        },
      ],
    });
    const oauthToken = `alex_oat_${"B".repeat(43)}`;

    const response = await POST(makeRequest(oauthToken, validMemorySaveCall));

    await expect(response.json()).resolves.toEqual({
      ok: false,
      service: "alexandria",
      surface: "mcp",
      error: "insufficient_scope",
    });
    expect(response.status).toBe(403);
    expect(executorRpc).not.toHaveBeenCalled();
  });

  it("dispatches memory_recall_recent with workspace and author filters", async () => {
    const { executorRpc } = mockMcpRpc();

    const response = await POST(
      makeRequest(validApiKey, {
        method: "memory_recall_recent",
        params: {
          author_profile_id: authorProfileId,
          limit: 2,
          since: "2026-05-01T00:00:00.000Z",
          workspace_id: "workspace-other",
        },
      }),
    );

    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "alexandria",
      surface: "mcp",
      method: "memory_recall_recent",
      memories: [
        {
          author_label: "MCP key",
          content: "The deployment freeze starts Friday.",
          created_at: "2026-05-03T12:00:00.000Z",
          kind: "policy",
          memory_id: memoryId,
          source: "mcp",
          source_client: "Claude Desktop",
          tags: ["policy"],
        },
      ],
    });
    expect(executorRpc).toHaveBeenCalledWith("recall_recent_mcp_memories", {
      p_author_profile_id: authorProfileId,
      p_limit: 2,
      p_mcp_key_id: "mcp-key-1",
      p_since: "2026-05-01T00:00:00.000Z",
      p_workspace_id: "workspace-1",
    });
  });

  it("dispatches memory_get and returns provenance", async () => {
    const { executorRpc } = mockMcpRpc();

    const response = await POST(
      makeRequest(validApiKey, {
        method: "memory_get",
        params: {
          memory_id: memoryId,
        },
      }),
    );

    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "alexandria",
      surface: "mcp",
      method: "memory_get",
      author_label: "MCP key",
      content: "Ashley Stambouli uses Shopify.",
      created_at: "2026-05-03T12:05:00.000Z",
      kind: "fact",
      memory_id: memoryId,
      source: "mcp",
      source_client: null,
      superseded_by_memory_id: null,
      tags: ["client/ashley-stambouli"],
      updated_at: "2026-05-03T12:06:00.000Z",
    });
    expect(executorRpc).toHaveBeenCalledWith("get_mcp_memory", {
      p_mcp_key_id: "mcp-key-1",
      p_memory_id: memoryId,
      p_workspace_id: "workspace-1",
    });
  });

  it("rejects cross-workspace memory_get access as not found", async () => {
    const { executorRpc } = mockMcpRpc({ getData: [] });

    const response = await POST(
      makeRequest(validApiKey, {
        method: "memory_get",
        params: {
          memory_id: memoryId,
          workspace_id: "workspace-other",
        },
      }),
    );

    await expect(response.json()).resolves.toEqual({
      ok: false,
      service: "alexandria",
      surface: "mcp",
      error: "memory_not_found",
    });
    expect(response.status).toBe(404);
    expect(executorRpc).toHaveBeenCalledWith("get_mcp_memory", {
      p_mcp_key_id: "mcp-key-1",
      p_memory_id: memoryId,
      p_workspace_id: "workspace-1",
    });
  });

  it("returns 501 for unsupported authenticated MCP methods", async () => {
    const { executorRpc, verifyRpc } = mockMcpRpc();

    const response = await POST(
      makeRequest(validApiKey, {
        method: "memory_delete",
      }),
    );

    await expect(response.json()).resolves.toEqual(unsupportedPayload);
    expect(response.status).toBe(501);
    expect(verifyRpc).toHaveBeenCalledWith("verify_mcp_api_key", {
      p_key_prefix: "abcdef12",
      p_presented_key: validApiKey,
    });
    expect(executorRpc).not.toHaveBeenCalled();
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
    [
      "missing search query",
      {
        method: "memory_search",
        params: {},
      },
      "query",
    ],
    [
      "bad recall since",
      {
        method: "memory_recall_recent",
        params: {
          since: "not-a-date",
        },
      },
      "since",
    ],
    [
      "bad get id",
      {
        method: "memory_get",
        params: {
          memory_id: "memory-1",
        },
      },
      "memory_id",
    ],
  ])("returns 400 for %s", async (_caseName, body, field) => {
    const { executorRpc, verifyRpc } = mockMcpRpc();

    const response = await POST(makeRequest(validApiKey, body));

    await expect(response.json()).resolves.toEqual({
      ok: false,
      service: "alexandria",
      surface: "mcp",
      error: "invalid_input",
      field,
    });
    expect(response.status).toBe(400);
    expect(verifyRpc).toHaveBeenCalledTimes(1);
    expect(executorRpc).not.toHaveBeenCalled();
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it("rejects missing and malformed Bearer keys before verification", async () => {
    await expectUnauthorizedResponse(await POST(makeRequest(null)));
    await expectUnauthorizedResponse(await POST(makeRequest("not-a-key")));
    expect(createSupabaseServiceRoleClient).not.toHaveBeenCalled();
    expect(createSupabaseMcpExecutorClient).not.toHaveBeenCalled();
  });

  it("rejects internal oauth_* sentinel key material on the legacy MCP API-key path", async () => {
    await expectUnauthorizedResponse(
      await POST(makeRequest("oauth_12345678_sentinel", validMemorySaveCall)),
    );
    await expectUnauthorizedResponse(
      await POST(
        makeRequest(`alex_oauth_12345678_${"0".repeat(32)}`, validMemorySaveCall),
      ),
    );
    expect(createSupabaseMcpExecutorClient).not.toHaveBeenCalled();
  });

  it("rejects invalid or revoked keys", async () => {
    const { executorRpc } = mockMcpRpc({ verifyData: [] });

    await expectUnauthorizedResponse(
      await POST(makeRequest(validApiKey, validMemorySaveCall)),
    );
    expect(executorRpc).not.toHaveBeenCalled();
  });
});
