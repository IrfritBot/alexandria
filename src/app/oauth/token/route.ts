import { verifyPkce } from "../../../lib/oauth/crypto";
import {
  consumeOAuthAuthorizationCode,
  createOAuthMcpKey,
  createOAuthTokenPair,
  ensureOAuthGrantActive,
  insertOAuthAccessToken,
  isOauthRefreshToken,
  loadOAuthClient,
  oauthTokenResponseBody,
  rotateOAuthRefreshToken,
} from "../../../lib/oauth/tokens";
import { createSupabaseServiceRoleClient } from "../../../lib/supabase/service-role";

export const dynamic = "force-dynamic";

function jsonResponse(body: unknown, status: number) {
  return Response.json(body, {
    headers: {
      "cache-control": "no-store",
    },
    status,
  });
}

function tokenError(error: string, status = 400) {
  return jsonResponse({ error }, status);
}

function requiredFormValue(formData: FormData, name: string) {
  const value = formData.get(name);

  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

async function parseForm(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.toLowerCase().includes("application/x-www-form-urlencoded")) {
    return null;
  }

  try {
    return await request.formData();
  } catch {
    return null;
  }
}

async function authorizationCodeGrant(formData: FormData) {
  const clientId = requiredFormValue(formData, "client_id");
  const code = requiredFormValue(formData, "code");
  const redirectUri = requiredFormValue(formData, "redirect_uri");
  const codeVerifier = requiredFormValue(formData, "code_verifier");

  if (!clientId || !code || !redirectUri || !codeVerifier) {
    return tokenError("invalid_request");
  }

  const supabase = createSupabaseServiceRoleClient() as never;
  const consumedCode = await consumeOAuthAuthorizationCode(supabase, code);

  if (!consumedCode) {
    return tokenError("invalid_grant");
  }

  if (
    consumedCode.clientId !== clientId ||
    consumedCode.redirectUri !== redirectUri
  ) {
    return tokenError("invalid_grant");
  }

  if (
    !verifyPkce({
      challenge: consumedCode.codeChallenge,
      method: consumedCode.codeChallengeMethod,
      verifier: codeVerifier,
    })
  ) {
    return tokenError("invalid_grant");
  }

  const client = await loadOAuthClient(supabase, clientId);

  if (!client) {
    return tokenError("invalid_client");
  }

  if (
    !(await ensureOAuthGrantActive(supabase, {
      profileId: consumedCode.profileId,
      workspaceId: consumedCode.workspaceId,
    }))
  ) {
    return tokenError("invalid_grant");
  }

  const mcpKey = await createOAuthMcpKey(supabase, {
    clientName: client.client_name,
    profileId: consumedCode.profileId,
    workspaceId: consumedCode.workspaceId,
  });

  if (!mcpKey) {
    return tokenError("server_error", 500);
  }

  const tokenPair = createOAuthTokenPair();
  const tokenInserted = await insertOAuthAccessToken(supabase, {
    clientId,
    mcpKeyId: mcpKey.id,
    profileId: consumedCode.profileId,
    scopes: consumedCode.scopes,
    tokenPair,
    workspaceId: consumedCode.workspaceId,
  });

  if (!tokenInserted) {
    return tokenError("server_error", 500);
  }

  return jsonResponse(
    oauthTokenResponseBody({
      scopes: consumedCode.scopes,
      tokenPair,
    }),
    200,
  );
}

async function refreshTokenGrant(formData: FormData) {
  const clientId = requiredFormValue(formData, "client_id");
  const refreshToken = requiredFormValue(formData, "refresh_token");

  if (!clientId || !refreshToken || !isOauthRefreshToken(refreshToken)) {
    return tokenError("invalid_request");
  }

  const supabase = createSupabaseServiceRoleClient() as never;
  const tokenPair = createOAuthTokenPair();
  const rotatedGrant = await rotateOAuthRefreshToken(supabase, {
    newTokenPair: tokenPair,
    refreshToken,
  });

  if (!rotatedGrant || rotatedGrant.clientId !== clientId) {
    return tokenError("invalid_grant");
  }

  if (
    !(await ensureOAuthGrantActive(supabase, {
      profileId: rotatedGrant.profileId,
      workspaceId: rotatedGrant.workspaceId,
    }))
  ) {
    return tokenError("invalid_grant");
  }

  return jsonResponse(
    oauthTokenResponseBody({
      scopes: rotatedGrant.scopes,
      tokenPair,
    }),
    200,
  );
}

export async function POST(request: Request) {
  const formData = await parseForm(request);

  if (!formData) {
    return tokenError("invalid_request");
  }

  const grantType = requiredFormValue(formData, "grant_type");

  if (grantType === "authorization_code") {
    return authorizationCodeGrant(formData);
  }

  if (grantType === "refresh_token") {
    return refreshTokenGrant(formData);
  }

  return tokenError("unsupported_grant_type");
}
