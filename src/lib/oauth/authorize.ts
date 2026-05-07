import {
  isRedirectUriRegistered,
  type OAuthClientRecord,
  type RegisteredOauthClient,
} from "./clients";
import { randomToken, sha256Token } from "./crypto";
import {
  parseOAuthScopes,
  serializeOAuthScopes,
  type OAuthScope,
} from "./scopes";

export type OAuthAuthorizeRequest = {
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  redirectUri: string;
  responseType: "code";
  scope: string;
  scopes: OAuthScope[];
  state: string | null;
};

export type ValidateAuthorizeRequestResult =
  | {
      ok: true;
      request: OAuthAuthorizeRequest;
    }
  | {
      ok: false;
      error: "invalid_request" | "invalid_scope" | "unsupported_response_type";
      field:
        | "client_id"
        | "code_challenge"
        | "code_challenge_method"
        | "redirect_uri"
        | "response_type"
        | "scope";
    };

function requiredParam(searchParams: URLSearchParams, name: string) {
  const value = searchParams.get(name);

  return value && value.trim().length > 0 ? value : null;
}

export function getAuthorizeClientId(searchParams: URLSearchParams) {
  return requiredParam(searchParams, "client_id");
}

export function validateAuthorizeRequest(
  searchParams: URLSearchParams,
  client: OAuthClientRecord | null,
): ValidateAuthorizeRequestResult {
  if (searchParams.get("response_type") !== "code") {
    return {
      error:
        searchParams.has("response_type") && searchParams.get("response_type")
          ? "unsupported_response_type"
          : "invalid_request",
      field: "response_type",
      ok: false,
    };
  }

  const clientId = requiredParam(searchParams, "client_id");

  if (!client || !clientId || client.client_id !== clientId) {
    return { error: "invalid_request", field: "client_id", ok: false };
  }

  const redirectUri = requiredParam(searchParams, "redirect_uri");

  if (
    !redirectUri ||
    !isRedirectUriRegistered(redirectUri, client.redirect_uris)
  ) {
    return { error: "invalid_request", field: "redirect_uri", ok: false };
  }

  const codeChallenge = requiredParam(searchParams, "code_challenge");

  if (!codeChallenge) {
    return { error: "invalid_request", field: "code_challenge", ok: false };
  }

  if (searchParams.get("code_challenge_method") !== "S256") {
    return {
      error: "invalid_request",
      field: "code_challenge_method",
      ok: false,
    };
  }

  const parsedScopes = parseOAuthScopes(searchParams.get("scope"));

  if (!parsedScopes.ok) {
    return { error: "invalid_scope", field: "scope", ok: false };
  }

  return {
    ok: true,
    request: {
      clientId,
      codeChallenge,
      codeChallengeMethod: "S256",
      redirectUri,
      responseType: "code",
      scope: serializeOAuthScopes(parsedScopes.scopes),
      scopes: parsedScopes.scopes,
      state: searchParams.get("state"),
    },
  };
}

export function redirectWithOAuthResult(input: {
  code?: string;
  error?: string;
  redirectUri: string;
  state?: string | null;
}) {
  const redirectUrl = new URL(input.redirectUri);

  if (input.code) {
    redirectUrl.searchParams.set("code", input.code);
  }

  if (input.error) {
    redirectUrl.searchParams.set("error", input.error);
  }

  if (input.state) {
    redirectUrl.searchParams.set("state", input.state);
  }

  return redirectUrl.toString();
}

export type OauthAuthorizeRequest = OAuthAuthorizeRequest;

export type OauthAuthorizeValidationResult =
  | { ok: true; request: OAuthAuthorizeRequest }
  | {
      ok: false;
      description: string;
      error:
        | "invalid_request"
        | "invalid_client"
        | "invalid_redirect_uri"
        | "invalid_scope"
        | "unsupported_response_type";
      redirectUri?: string;
      state?: string | null;
    };

function toClientRecord(
  client: RegisteredOauthClient | OAuthClientRecord | null,
): OAuthClientRecord | null {
  if (!client) {
    return null;
  }

  if ("client_id" in client) {
    return client;
  }

  return {
    client_id: client.clientId,
    client_name: client.clientName,
    redirect_uris: client.redirectUris,
  };
}

export function validateAuthorizeParams(
  searchParams: URLSearchParams,
  client: RegisteredOauthClient | OAuthClientRecord | null,
): OauthAuthorizeValidationResult {
  const redirectUri = searchParams.get("redirect_uri");
  const state = searchParams.get("state");
  const result = validateAuthorizeRequest(searchParams, toClientRecord(client));

  if (result.ok) {
    return result;
  }

  if (result.field === "client_id") {
    return {
      description: "Unknown OAuth client.",
      error: "invalid_client",
      ok: false,
      state,
    };
  }

  if (result.field === "redirect_uri") {
    return {
      description: "The redirect_uri is not registered for this client.",
      error: "invalid_redirect_uri",
      ok: false,
      state,
    };
  }

  return {
    description: "The OAuth authorization request is invalid.",
    error: result.error,
    ok: false,
    redirectUri: redirectUri ?? undefined,
    state,
  };
}

export function createAuthorizationCode() {
  const code = randomToken(32);

  return {
    code,
    codeHash: sha256Token(code),
  };
}

export function oauthCodeRedirectUrl(input: {
  code: string;
  redirectUri: string;
  state?: string | null;
}) {
  return new URL(
    redirectWithOAuthResult({
      code: input.code,
      redirectUri: input.redirectUri,
      state: input.state,
    }),
  );
}

export function oauthErrorRedirectUrl(input: {
  error: string;
  redirectUri: string;
  state?: string | null;
}) {
  return new URL(
    redirectWithOAuthResult({
      error: input.error,
      redirectUri: input.redirectUri,
      state: input.state,
    }),
  );
}
