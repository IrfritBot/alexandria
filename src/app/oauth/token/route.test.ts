import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sha256Token } from "../../../lib/oauth/crypto";
import { createSupabaseServiceRoleClient } from "../../../lib/supabase/service-role";
import { POST } from "./route";

vi.mock("server-only", () => ({}));

vi.mock("../../../lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

const codeVerifier = "v".repeat(43);
const codeChallenge = createHash("sha256")
  .update(codeVerifier)
  .digest("base64url");

const defaultCodeRow = {
  client_id: "alex_client_123",
  code_challenge: codeChallenge,
  code_challenge_method: "S256",
  profile_id: "profile-1",
  redirect_uri: "https://client.example/callback",
  scopes: ["memory:read", "memory:write"],
  workspace_id: "workspace-1",
};

const defaultGrantRow = {
  client_id: "alex_client_123",
  mcp_key_id: "mcp-key-1",
  profile_id: "profile-1",
  scopes: ["memory:read"],
  workspace_id: "workspace-1",
};

function makeTokenRequest(body: Record<string, string>) {
  return new Request("https://alexandria.test/oauth/token", {
    body: new URLSearchParams(body),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
}

function authorizationCodeRequest(overrides: Record<string, string> = {}) {
  return makeTokenRequest({
    client_id: "alex_client_123",
    code: "authorization-code",
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: "https://client.example/callback",
    ...overrides,
  });
}

function refreshRequest(overrides: Record<string, string> = {}) {
  return makeTokenRequest({
    client_id: "alex_client_123",
    grant_type: "refresh_token",
    refresh_token: `alex_ort_${"A".repeat(43)}`,
    ...overrides,
  });
}

function mockService(input: {
  clientRow?: unknown;
  codeRows?: unknown[];
  membershipRow?: unknown;
  profileRow?: unknown;
  rotateRows?: unknown[];
  rpcError?: { message?: string } | null;
  tokenInsertError?: { message?: string } | null;
} = {}) {
  const rpc = vi.fn(async (functionName: string) => {
    if (input.rpcError) {
      return { data: null, error: input.rpcError };
    }

    if (functionName === "consume_oauth_authorization_code") {
      return {
        data: input.codeRows === undefined ? [defaultCodeRow] : input.codeRows,
        error: null,
      };
    }

    if (functionName === "rotate_oauth_refresh_token") {
      return {
        data:
          input.rotateRows === undefined ? [defaultGrantRow] : input.rotateRows,
        error: null,
      };
    }

    return { data: null, error: { message: "unexpected rpc" } };
  });
  const clientMaybeSingle = vi.fn(async () => ({
    data:
      input.clientRow === undefined
        ? {
            client_id: "alex_client_123",
            client_name: "Claude Desktop",
            redirect_uris: ["https://client.example/callback"],
          }
        : input.clientRow,
    error: null,
  }));
  const profileMaybeSingle = vi.fn(async () => ({
    data: input.profileRow === undefined ? { id: "profile-1" } : input.profileRow,
    error: null,
  }));
  const membershipMaybeSingle = vi.fn(async () => ({
    data:
      input.membershipRow === undefined
        ? { id: "membership-1" }
        : input.membershipRow,
    error: null,
  }));
  const mcpMaybeSingle = vi.fn(async () => ({
    data: { id: "mcp-key-1" },
    error: null,
  }));
  const mcpSelect = vi.fn(() => ({ maybeSingle: mcpMaybeSingle }));
  const mcpInsert = vi.fn(() => ({ select: mcpSelect }));
  const tokenInsert = vi.fn(async () => ({
    error: input.tokenInsertError ?? null,
  }));
  const from = vi.fn((tableName: string) => {
    if (tableName === "oauth_clients") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: clientMaybeSingle })),
        })),
      };
    }

    if (tableName === "profiles") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(() => ({ maybeSingle: profileMaybeSingle })),
          })),
        })),
      };
    }

    if (tableName === "workspace_members") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: membershipMaybeSingle })),
          })),
        })),
      };
    }

    if (tableName === "mcp_keys") {
      return { insert: mcpInsert };
    }

    return { insert: tokenInsert };
  });

  vi.mocked(createSupabaseServiceRoleClient).mockReturnValue({
    from,
    rpc,
  } as never);

  return { from, mcpInsert, rpc, tokenInsert };
}

describe("OAuth token route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T12:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("exchanges an authorization code for bearer tokens and creates an internal OAuth MCP key", async () => {
    const { mcpInsert, rpc, tokenInsert } = mockService();

    const response = await POST(authorizationCodeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      access_token: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
      expires_in: 3600,
      refresh_token: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
      scope: "memory:read memory:write",
      token_type: "Bearer",
    });
    expect(rpc).toHaveBeenCalledWith("consume_oauth_authorization_code", {
      p_code_hash: sha256Token("authorization-code"),
    });
    expect(mcpInsert).toHaveBeenCalledWith({
      created_by_profile_id: "profile-1",
      key_hash: expect.stringMatching(/^oauth_sentinel:/),
      key_prefix: expect.stringMatching(/^oauth_[a-f0-9]{8}$/),
      name: "OAuth connector: Claude Desktop",
      workspace_id: "workspace-1",
    });
    expect(tokenInsert).toHaveBeenCalledWith({
      client_id: "alex_client_123",
      expires_at: "2026-05-07T13:30:00.000Z",
      mcp_key_id: "mcp-key-1",
      profile_id: "profile-1",
      refresh_expires_at: "2026-06-06T12:30:00.000Z",
      refresh_token_hash: sha256Token(body.refresh_token),
      scopes: ["memory:read", "memory:write"],
      token_hash: sha256Token(body.access_token),
      workspace_id: "workspace-1",
    });
    expect(JSON.stringify(body)).not.toContain("token_hash");
  });

  it("rejects replayed or already-consumed authorization codes", async () => {
    const { mcpInsert, tokenInsert } = mockService({ codeRows: [] });

    const response = await POST(authorizationCodeRequest());

    await expect(response.json()).resolves.toEqual({ error: "invalid_grant" });
    expect(response.status).toBe(400);
    expect(mcpInsert).not.toHaveBeenCalled();
    expect(tokenInsert).not.toHaveBeenCalled();
  });

  it("rejects expired authorization codes", async () => {
    mockService({ codeRows: [] });
    const response = await POST(authorizationCodeRequest());

    await expect(response.json()).resolves.toEqual({ error: "invalid_grant" });
  });

  it("rejects PKCE failures and redirect mismatches after consuming the code", async () => {
    mockService();

    await expect(
      (await POST(authorizationCodeRequest({ code_verifier: "x".repeat(43) }))).json(),
    ).resolves.toEqual({ error: "invalid_grant" });

    mockService();
    await expect(
      (
        await POST(
          authorizationCodeRequest({
            redirect_uri: "https://client.example/other",
          }),
        )
      ).json(),
    ).resolves.toEqual({ error: "invalid_grant" });
  });

  it("rejects authorization-code exchange when membership was removed after consent", async () => {
    const { mcpInsert, tokenInsert } = mockService({ membershipRow: null });

    const response = await POST(authorizationCodeRequest());

    await expect(response.json()).resolves.toEqual({ error: "invalid_grant" });
    expect(mcpInsert).not.toHaveBeenCalled();
    expect(tokenInsert).not.toHaveBeenCalled();
  });

  it("rotates refresh tokens and returns a new bearer pair", async () => {
    const { rpc } = mockService();

    const response = await POST(refreshRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      access_token: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
      expires_in: 3600,
      refresh_token: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
      scope: "memory:read",
      token_type: "Bearer",
    });
    expect(rpc).toHaveBeenCalledWith("rotate_oauth_refresh_token", {
      p_access_expires_at: "2026-05-07T13:30:00.000Z",
      p_new_refresh_token_hash: sha256Token(body.refresh_token),
      p_new_token_hash: sha256Token(body.access_token),
      p_refresh_expires_at: "2026-06-06T12:30:00.000Z",
      p_refresh_token_hash: sha256Token(`alex_ort_${"A".repeat(43)}`),
    });
  });

  it("rejects replayed refresh tokens", async () => {
    mockService({ rotateRows: [] });

    const response = await POST(refreshRequest());

    await expect(response.json()).resolves.toEqual({ error: "invalid_grant" });
    expect(response.status).toBe(400);
  });

  it("rejects refresh after workspace membership removal", async () => {
    mockService({ membershipRow: null });

    const response = await POST(refreshRequest());

    await expect(response.json()).resolves.toEqual({ error: "invalid_grant" });
    expect(response.status).toBe(400);
  });

  it("rejects invalid refresh grants", async () => {
    mockService({ rpcError: { message: "invalid refresh" } });

    const response = await POST(refreshRequest());

    await expect(response.json()).resolves.toEqual({ error: "invalid_grant" });
    expect(response.status).toBe(400);
  });
});
