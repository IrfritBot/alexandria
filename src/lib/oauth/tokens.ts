import { randomBytes } from "node:crypto";

import { type OAuthClientRecord } from "./clients";
import { randomToken, sha256Token } from "./crypto";
import { isOAuthScope, serializeOAuthScopes, type OAuthScope } from "./scopes";
import type { ValidMcpSession } from "../mcp/api-keys";
import { createSupabaseServiceRoleClient } from "../supabase/service-role";

export const OAUTH_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const OAUTH_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const OAUTH_ACCESS_TOKEN_EXPIRES_IN_SECONDS =
  OAUTH_ACCESS_TOKEN_TTL_SECONDS;
export const OAUTH_REFRESH_TOKEN_EXPIRES_IN_SECONDS =
  OAUTH_REFRESH_TOKEN_TTL_SECONDS;

const OAUTH_ACCESS_TOKEN_PATTERN = /^alex_oat_[A-Za-z0-9_-]{43,}$/;
const OAUTH_REFRESH_TOKEN_PATTERN = /^alex_ort_[A-Za-z0-9_-]{43,}$/;

type SupabaseError = {
  code?: string;
  message?: string;
};

type RpcClient = {
  rpc(
    functionName: string,
    args?: Record<string, unknown>,
  ): Promise<{
    data: unknown;
    error: SupabaseError | null;
  }>;
};

type OAuthStorageClient = RpcClient & {
  from(tableName: string): {
    insert(payload: Record<string, unknown>): unknown;
    select(columns: string): unknown;
    update?(payload: Record<string, unknown>): unknown;
  };
};

export type ConsumedAuthorizationCode = {
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  profileId: string;
  redirectUri: string;
  scopes: string[];
  workspaceId: string;
};

export type OAuthTokenGrant = {
  clientId: string;
  mcpKeyId: string;
  profileId: string;
  scopes: string[];
  workspaceId: string;
};

export type OAuthTokenPair = {
  accessExpiresAt: Date;
  accessToken: string;
  accessTokenHash: string;
  expiresIn: typeof OAUTH_ACCESS_TOKEN_TTL_SECONDS;
  refreshExpiresAt: Date;
  refreshToken: string;
  refreshTokenHash: string;
  tokenType: "Bearer";
};

function normalizeRows(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null && !Array.isArray(row),
  );
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function randomHex(byteLength: number) {
  return randomBytes(byteLength).toString("hex");
}

export function createOAuthTokenPair(now = new Date()): OAuthTokenPair {
  const accessToken = generateOauthAccessToken();
  const refreshToken = generateOauthRefreshToken();

  return {
    accessExpiresAt: new Date(
      now.getTime() + OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000,
    ),
    accessToken,
    accessTokenHash: sha256Token(accessToken),
    expiresIn: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    refreshExpiresAt: new Date(
      now.getTime() + OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000,
    ),
    refreshToken,
    refreshTokenHash: sha256Token(refreshToken),
    tokenType: "Bearer",
  };
}

export function normalizeConsumedAuthorizationCode(
  data: unknown,
): ConsumedAuthorizationCode | null {
  const [row] = normalizeRows(data);

  if (
    typeof row?.client_id !== "string" ||
    typeof row.redirect_uri !== "string" ||
    typeof row.code_challenge !== "string" ||
    typeof row.code_challenge_method !== "string" ||
    typeof row.profile_id !== "string" ||
    typeof row.workspace_id !== "string"
  ) {
    return null;
  }

  return {
    clientId: row.client_id,
    codeChallenge: row.code_challenge,
    codeChallengeMethod: row.code_challenge_method,
    profileId: row.profile_id,
    redirectUri: row.redirect_uri,
    scopes: normalizeStringArray(row.scopes),
    workspaceId: row.workspace_id,
  };
}

export function normalizeOAuthTokenGrant(data: unknown): OAuthTokenGrant | null {
  const [row] = normalizeRows(data);

  if (
    typeof row?.client_id !== "string" ||
    typeof row.profile_id !== "string" ||
    typeof row.workspace_id !== "string" ||
    typeof row.mcp_key_id !== "string"
  ) {
    return null;
  }

  return {
    clientId: row.client_id,
    mcpKeyId: row.mcp_key_id,
    profileId: row.profile_id,
    scopes: normalizeStringArray(row.scopes),
    workspaceId: row.workspace_id,
  };
}

export async function loadOAuthClient(
  client: OAuthStorageClient,
  clientId: string,
): Promise<OAuthClientRecord | null> {
  const query = client.from("oauth_clients").select(
    "client_id, client_name, redirect_uris",
  ) as {
    eq(column: string, value: string): {
      maybeSingle(): Promise<{ data: unknown; error: SupabaseError | null }>;
    };
  };
  const { data, error } = await query.eq("client_id", clientId).maybeSingle();

  if (error || typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }

  const row = data as Record<string, unknown>;

  if (
    typeof row.client_id !== "string" ||
    typeof row.client_name !== "string" ||
    !Array.isArray(row.redirect_uris) ||
    !row.redirect_uris.every((value): value is string => typeof value === "string")
  ) {
    return null;
  }

  return {
    client_id: row.client_id,
    client_name: row.client_name,
    redirect_uris: row.redirect_uris,
  };
}

export async function consumeOAuthAuthorizationCode(
  client: RpcClient,
  authorizationCode: string,
) {
  const { data, error } = await client.rpc("consume_oauth_authorization_code", {
    p_code_hash: sha256Token(authorizationCode),
  });

  if (error) {
    return null;
  }

  return normalizeConsumedAuthorizationCode(data);
}

export async function rotateOAuthRefreshToken(
  client: RpcClient,
  input: {
    clientId: string;
    newTokenPair: OAuthTokenPair;
    refreshToken: string;
  },
) {
  const { data, error } = await client.rpc("rotate_oauth_refresh_token", {
    p_access_expires_at: input.newTokenPair.accessExpiresAt.toISOString(),
    p_client_id: input.clientId,
    p_new_refresh_token_hash: input.newTokenPair.refreshTokenHash,
    p_new_token_hash: input.newTokenPair.accessTokenHash,
    p_refresh_expires_at: input.newTokenPair.refreshExpiresAt.toISOString(),
    p_refresh_token_hash: sha256Token(input.refreshToken),
  });

  if (error) {
    return null;
  }

  return normalizeOAuthTokenGrant(data);
}

export async function ensureOAuthGrantActive(
  client: OAuthStorageClient,
  input: { profileId: string; workspaceId: string },
) {
  const profileQuery = client
    .from("profiles")
    .select("id") as {
    eq(column: string, value: string): {
      is(column: string, value: null): {
        maybeSingle(): Promise<{ data: unknown; error: SupabaseError | null }>;
      };
    };
  };
  const { data: profileRow, error: profileError } = await profileQuery
    .eq("id", input.profileId)
    .is("deleted_at", null)
    .maybeSingle();

  if (
    profileError ||
    typeof profileRow !== "object" ||
    profileRow === null ||
    Array.isArray(profileRow)
  ) {
    return false;
  }

  const membershipQuery = client
    .from("workspace_members")
    .select("id") as {
    eq(column: string, value: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<{ data: unknown; error: SupabaseError | null }>;
      };
    };
  };
  const { data: membershipRow, error: membershipError } = await membershipQuery
    .eq("profile_id", input.profileId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();

  return Boolean(
    !membershipError &&
      typeof membershipRow === "object" &&
      membershipRow !== null &&
      !Array.isArray(membershipRow),
  );
}

export async function createOAuthMcpKey(
  client: OAuthStorageClient,
  input: {
    clientName: string;
    profileId: string;
    workspaceId: string;
  },
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const keyPrefix = `oauth_${randomHex(4)}`;
    const keyHash = `oauth_sentinel:${sha256Token(keyPrefix)}`;
    const insertQuery = client.from("mcp_keys").insert({
      created_by_profile_id: input.profileId,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      name: `OAuth connector: ${input.clientName}`,
      workspace_id: input.workspaceId,
    }) as {
      select(columns: string): {
        maybeSingle(): Promise<{ data: unknown; error: SupabaseError | null }>;
      };
    };
    const { data, error } = await insertQuery.select("id").maybeSingle();

    if (error?.code === "23505") {
      continue;
    }

    if (
      error ||
      typeof data !== "object" ||
      data === null ||
      Array.isArray(data) ||
      typeof (data as Record<string, unknown>).id !== "string"
    ) {
      return null;
    }

    return {
      id: (data as Record<string, string>).id,
      keyHash,
      keyPrefix,
    };
  }

  return null;
}

export async function insertOAuthAccessToken(
  client: OAuthStorageClient,
  input: {
    clientId: string;
    mcpKeyId: string;
    profileId: string;
    scopes: string[];
    tokenPair: OAuthTokenPair;
    workspaceId: string;
  },
) {
  const insertResult = client.from("oauth_access_tokens").insert({
    client_id: input.clientId,
    expires_at: input.tokenPair.accessExpiresAt.toISOString(),
    mcp_key_id: input.mcpKeyId,
    profile_id: input.profileId,
    refresh_expires_at: input.tokenPair.refreshExpiresAt.toISOString(),
    refresh_token_hash: input.tokenPair.refreshTokenHash,
    scopes: input.scopes,
    token_hash: input.tokenPair.accessTokenHash,
    workspace_id: input.workspaceId,
  }) as Promise<{ error: SupabaseError | null }>;
  const { error } = await insertResult;

  return !error;
}

export async function validateOAuthAccessToken(
  client: RpcClient,
  accessToken: string,
) {
  const { data, error } = await client.rpc("verify_oauth_access_token", {
    p_token_hash: sha256Token(accessToken),
  });

  if (error) {
    return null;
  }

  return normalizeOAuthTokenGrant(data);
}

export function oauthTokenResponseBody(input: {
  scopes: string[];
  tokenPair: OAuthTokenPair;
}) {
  return {
    access_token: input.tokenPair.accessToken,
    expires_in: input.tokenPair.expiresIn,
    refresh_token: input.tokenPair.refreshToken,
    scope: serializeOAuthScopes(input.scopes),
    token_type: input.tokenPair.tokenType,
  };
}

function normalizeOAuthScopesForSession(value: unknown): OAuthScope[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((scope): scope is OAuthScope => {
    return typeof scope === "string" && isOAuthScope(scope);
  });
}

export function generateOauthAccessToken() {
  return `alex_oat_${randomToken(32)}`;
}

export function generateOauthRefreshToken() {
  return `alex_ort_${randomToken(32)}`;
}

export function isOauthAccessToken(token: string) {
  return OAUTH_ACCESS_TOKEN_PATTERN.test(token);
}

export function isOauthRefreshToken(token: string) {
  return OAUTH_REFRESH_TOKEN_PATTERN.test(token);
}

export function accessTokenExpiresAt(now = new Date()) {
  return new Date(
    now.getTime() + OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000,
  ).toISOString();
}

export function refreshTokenExpiresAt(now = new Date()) {
  return new Date(
    now.getTime() + OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000,
  ).toISOString();
}

export function oauthTokenResponse(input: {
  accessToken: string;
  refreshToken: string;
  scopes: readonly string[];
}) {
  return {
    access_token: input.accessToken,
    expires_in: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: input.refreshToken,
    scope: serializeOAuthScopes(input.scopes),
    token_type: "Bearer",
  };
}

export async function validateOauthAccessToken(
  accessToken: string,
  client?: RpcClient,
): Promise<
  | { ok: true; session: ValidMcpSession }
  | { ok: false; reason: "malformed" | "invalid" }
> {
  if (!isOauthAccessToken(accessToken)) {
    return { ok: false, reason: "malformed" };
  }

  let grant: OAuthTokenGrant | null;

  try {
    const rpcClient =
      client ?? ((createSupabaseServiceRoleClient() as unknown) as RpcClient);
    grant = await validateOAuthAccessToken(rpcClient, accessToken);
  } catch {
    return { ok: false, reason: "invalid" };
  }

  const scopes = normalizeOAuthScopesForSession(grant?.scopes);

  if (!grant || scopes.length === 0) {
    return { ok: false, reason: "invalid" };
  }

  return {
    ok: true,
    session: {
      authKind: "oauth",
      clientId: grant.clientId,
      mcpKeyId: grant.mcpKeyId,
      profileId: grant.profileId,
      scopes,
      workspaceId: grant.workspaceId,
    },
  };
}
