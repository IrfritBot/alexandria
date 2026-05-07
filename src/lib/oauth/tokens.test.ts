import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../supabase/service-role", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

import {
  consumeOAuthAuthorizationCode,
  createOAuthMcpKey,
  createOAuthTokenPair,
  ensureOAuthGrantActive,
  insertOAuthAccessToken,
  normalizeConsumedAuthorizationCode,
  normalizeOAuthTokenGrant,
  oauthTokenResponseBody,
  rotateOAuthRefreshToken,
  validateOAuthAccessToken,
} from "./tokens";
import { sha256Token } from "./crypto";

vi.mock("server-only", () => ({}));

function mockMembershipClient(input: {
  membership?: unknown;
  profile?: unknown;
}) {
  const profileMaybeSingle = vi.fn(async () => ({
    data: input.profile === undefined ? { id: "profile-1" } : input.profile,
    error: null,
  }));
  const membershipMaybeSingle = vi.fn(async () => ({
    data:
      input.membership === undefined ? { id: "membership-1" } : input.membership,
    error: null,
  }));
  const from = vi.fn((tableName: string) => {
    if (tableName === "profiles") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(() => ({ maybeSingle: profileMaybeSingle })),
          })),
        })),
      };
    }

    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: membershipMaybeSingle })),
        })),
      })),
    };
  });

  return { from, rpc: vi.fn() };
}

describe("OAuth token helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T12:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("creates hashed access/refresh token pairs with configured lifetimes", () => {
    const tokenPair = createOAuthTokenPair();

    expect(tokenPair.accessToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(tokenPair.refreshToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(tokenPair.accessTokenHash).toBe(sha256Token(tokenPair.accessToken));
    expect(tokenPair.refreshTokenHash).toBe(sha256Token(tokenPair.refreshToken));
    expect(tokenPair.expiresIn).toBe(3600);
    expect(tokenPair.accessExpiresAt.toISOString()).toBe(
      "2026-05-07T13:30:00.000Z",
    );
    expect(tokenPair.refreshExpiresAt.toISOString()).toBe(
      "2026-06-06T12:30:00.000Z",
    );
  });

  it("normalizes consumed authorization code and token grant rows", () => {
    expect(
      normalizeConsumedAuthorizationCode([
        {
          client_id: "alex_client_1",
          code_challenge: "challenge",
          code_challenge_method: "S256",
          profile_id: "profile-1",
          redirect_uri: "https://client.example/callback",
          scopes: ["memory:read"],
          workspace_id: "workspace-1",
        },
      ]),
    ).toEqual({
      clientId: "alex_client_1",
      codeChallenge: "challenge",
      codeChallengeMethod: "S256",
      profileId: "profile-1",
      redirectUri: "https://client.example/callback",
      scopes: ["memory:read"],
      workspaceId: "workspace-1",
    });

    expect(
      normalizeOAuthTokenGrant([
        {
          client_id: "alex_client_1",
          mcp_key_id: "mcp-key-1",
          profile_id: "profile-1",
          scopes: ["memory:read"],
          workspace_id: "workspace-1",
        },
      ]),
    ).toEqual({
      clientId: "alex_client_1",
      mcpKeyId: "mcp-key-1",
      profileId: "profile-1",
      scopes: ["memory:read"],
      workspaceId: "workspace-1",
    });
  });

  it("consumes authorization codes and rotates refresh tokens through private RPCs", async () => {
    const tokenPair = createOAuthTokenPair();
    const rpc = vi.fn(async (functionName: string) => {
      if (functionName === "consume_oauth_authorization_code") {
        return {
          data: [
            {
              client_id: "alex_client_1",
              code_challenge: "challenge",
              code_challenge_method: "S256",
              profile_id: "profile-1",
              redirect_uri: "https://client.example/callback",
              scopes: ["memory:read"],
              workspace_id: "workspace-1",
            },
          ],
          error: null,
        };
      }

      return {
        data: [
          {
            client_id: "alex_client_1",
            mcp_key_id: "mcp-key-1",
            profile_id: "profile-1",
            scopes: ["memory:read"],
            workspace_id: "workspace-1",
          },
        ],
        error: null,
      };
    });

    await expect(
      consumeOAuthAuthorizationCode({ rpc }, "authorization-code"),
    ).resolves.toMatchObject({
      clientId: "alex_client_1",
    });
    expect(rpc).toHaveBeenCalledWith("consume_oauth_authorization_code", {
      p_code_hash: sha256Token("authorization-code"),
    });

    await expect(
      rotateOAuthRefreshToken(
        { rpc },
        { newTokenPair: tokenPair, refreshToken: "refresh-token" },
      ),
    ).resolves.toMatchObject({
      mcpKeyId: "mcp-key-1",
    });
    expect(rpc).toHaveBeenCalledWith("rotate_oauth_refresh_token", {
      p_access_expires_at: tokenPair.accessExpiresAt.toISOString(),
      p_new_refresh_token_hash: tokenPair.refreshTokenHash,
      p_new_token_hash: tokenPair.accessTokenHash,
      p_refresh_expires_at: tokenPair.refreshExpiresAt.toISOString(),
      p_refresh_token_hash: sha256Token("refresh-token"),
    });
  });

  it("checks active profile and workspace membership through service-role storage", async () => {
    await expect(
      ensureOAuthGrantActive(
        mockMembershipClient({}) as never,
        {
          profileId: "profile-1",
          workspaceId: "workspace-1",
        },
      ),
    ).resolves.toBe(true);

    await expect(
      ensureOAuthGrantActive(
        mockMembershipClient({ membership: null }) as never,
        {
          profileId: "profile-1",
          workspaceId: "workspace-1",
        },
      ),
    ).resolves.toBe(false);
  });

  it("creates internal oauth_* MCP key rows with non-secret sentinel hashes", async () => {
    const maybeSingle = vi.fn(async () => ({
      data: { id: "mcp-key-1" },
      error: null,
    }));
    const select = vi.fn(() => ({ maybeSingle }));
    const insert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ insert }));

    const result = await createOAuthMcpKey(
      { from, rpc: vi.fn() } as never,
      {
        clientName: "Claude Desktop",
        profileId: "profile-1",
        workspaceId: "workspace-1",
      },
    );

    expect(result?.id).toBe("mcp-key-1");
    expect(result?.keyPrefix).toMatch(/^oauth_[a-f0-9]{8}$/);
    expect(result?.keyHash).toMatch(/^oauth_sentinel:/);
    expect(insert).toHaveBeenCalledWith({
      created_by_profile_id: "profile-1",
      key_hash: result?.keyHash,
      key_prefix: result?.keyPrefix,
      name: "OAuth connector: Claude Desktop",
      workspace_id: "workspace-1",
    });
  });

  it("stores only token hashes and returns bearer response bodies", async () => {
    const tokenPair = createOAuthTokenPair();
    const insert = vi.fn(async () => ({ error: null }));
    const from = vi.fn(() => ({ insert }));

    await expect(
      insertOAuthAccessToken(
        { from, rpc: vi.fn() } as never,
        {
          clientId: "alex_client_1",
          mcpKeyId: "mcp-key-1",
          profileId: "profile-1",
          scopes: ["memory:read"],
          tokenPair,
          workspaceId: "workspace-1",
        },
      ),
    ).resolves.toBe(true);
    expect(insert).toHaveBeenCalledWith({
      client_id: "alex_client_1",
      expires_at: tokenPair.accessExpiresAt.toISOString(),
      mcp_key_id: "mcp-key-1",
      profile_id: "profile-1",
      refresh_expires_at: tokenPair.refreshExpiresAt.toISOString(),
      refresh_token_hash: tokenPair.refreshTokenHash,
      scopes: ["memory:read"],
      token_hash: tokenPair.accessTokenHash,
      workspace_id: "workspace-1",
    });
    expect(JSON.stringify(insert.mock.calls)).not.toContain(tokenPair.accessToken);
    expect(oauthTokenResponseBody({ scopes: ["memory:read"], tokenPair })).toEqual({
      access_token: tokenPair.accessToken,
      expires_in: 3600,
      refresh_token: tokenPair.refreshToken,
      scope: "memory:read",
      token_type: "Bearer",
    });
  });

  it("validates access tokens through the private OAuth verifier RPC", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          client_id: "alex_client_1",
          mcp_key_id: "mcp-key-1",
          profile_id: "profile-1",
          scopes: ["memory:read"],
          workspace_id: "workspace-1",
        },
      ],
      error: null,
    }));

    await expect(validateOAuthAccessToken({ rpc }, "access-token")).resolves.toEqual({
      clientId: "alex_client_1",
      mcpKeyId: "mcp-key-1",
      profileId: "profile-1",
      scopes: ["memory:read"],
      workspaceId: "workspace-1",
    });
    expect(rpc).toHaveBeenCalledWith("verify_oauth_access_token", {
      p_token_hash: sha256Token("access-token"),
    });
  });
});
