import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";
import { createSupabaseServiceRoleClient } from "../../../lib/supabase/service-role";

vi.mock("server-only", () => ({}));

vi.mock("../../../lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

const notImplementedPayload = {
  ok: false,
  service: "alexandria",
  surface: "mcp",
  status: "not_implemented",
  message:
    "MCP transport and memory tools are intentionally stubbed for Sprint 1A.",
};

const unauthorizedPayload = {
  ok: false,
  service: "alexandria",
  surface: "mcp",
  error: "invalid_mcp_key",
};

const validApiKey = `alex_abcdef12_${"0".repeat(32)}`;

function makeRequest(apiKey: string | null = validApiKey) {
  const headers = new Headers();

  if (apiKey) {
    headers.set("authorization", `Bearer ${apiKey}`);
  }

  return new Request("https://alexandria.test/api/mcp", {
    headers,
    method: "POST",
  });
}

function mockVerifyResponse(data: unknown[]) {
  const rpc = vi.fn(async () => ({
    data,
    error: null,
  }));

  vi.mocked(createSupabaseServiceRoleClient).mockReturnValue({
    rpc,
  } as never);

  return rpc;
}

async function expectNotImplementedResponse(response: Response) {
  await expect(response.json()).resolves.toEqual(notImplementedPayload);
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
    mockVerifyResponse([
      {
        id: "mcp-key-1",
        workspace_id: "workspace-1",
      },
    ]);

    await expectNotImplementedResponse(await GET(makeRequest()));
  });

  it("returns the stable 501 contract for authenticated POST", async () => {
    const rpc = mockVerifyResponse([
      {
        id: "mcp-key-1",
        workspace_id: "workspace-1",
      },
    ]);

    await expectNotImplementedResponse(await POST(makeRequest()));
    expect(rpc).toHaveBeenCalledWith("verify_mcp_api_key", {
      p_key_prefix: "abcdef12",
      p_presented_key: validApiKey,
    });
  });

  it("rejects missing and malformed Bearer keys before verification", async () => {
    await expectUnauthorizedResponse(await POST(makeRequest(null)));
    await expectUnauthorizedResponse(await POST(makeRequest("not-a-key")));
    expect(createSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });

  it("rejects invalid or revoked keys", async () => {
    mockVerifyResponse([]);

    await expectUnauthorizedResponse(await POST(makeRequest()));
  });
});
