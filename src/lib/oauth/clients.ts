import { randomToken } from "./crypto";

export type OAuthClientRecord = {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
};

export type RegisteredOauthClient = {
  clientId: string;
  clientName: string;
  redirectUris: string[];
};

export type NormalizeClientPayloadResult =
  | {
      ok: true;
      clientName: string;
      redirectUris: string[];
    }
  | {
      ok: false;
      field: "client_name" | "redirect_uris";
    };

function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

export function isValidRedirectUri(redirectUri: string) {
  if (
    redirectUri.trim() !== redirectUri ||
    redirectUri.length === 0 ||
    redirectUri.includes("*") ||
    redirectUri.includes("\\") ||
    /\s/.test(redirectUri)
  ) {
    return false;
  }

  let url: URL;

  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }

  if (url.hash.length > 0) {
    return false;
  }

  if (url.protocol === "https:") {
    return url.hostname.length > 0;
  }

  if (url.protocol === "http:") {
    return isLoopbackHost(url.hostname);
  }

  return false;
}

export const validateRedirectUri = isValidRedirectUri;

export function validateRedirectUris(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const seen = new Set<string>();
  const redirectUris: string[] = [];

  for (const item of value) {
    if (typeof item !== "string" || !isValidRedirectUri(item)) {
      return null;
    }

    if (!seen.has(item)) {
      seen.add(item);
      redirectUris.push(item);
    }
  }

  return redirectUris;
}

export function normalizeClientRegistrationPayload(
  payload: unknown,
): NormalizeClientPayloadResult {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { ok: false, field: "client_name" };
  }

  const record = payload as Record<string, unknown>;
  const clientName =
    typeof record.client_name === "string" ? record.client_name.trim() : "";

  if (!clientName) {
    return { ok: false, field: "client_name" };
  }

  const redirectUris = validateRedirectUris(record.redirect_uris);

  if (!redirectUris) {
    return { ok: false, field: "redirect_uris" };
  }

  return {
    clientName,
    ok: true,
    redirectUris,
  };
}

export function normalizeOauthClientRegistrationPayload(payload: unknown) {
  const result = normalizeClientRegistrationPayload(payload);

  if (!result.ok) {
    return {
      ok: false as const,
      reason:
        result.field === "client_name"
          ? ("invalid_client_name" as const)
          : ("invalid_redirect_uris" as const),
    };
  }

  return {
    client: {
      clientName: result.clientName,
      redirectUris: result.redirectUris,
    },
    ok: true as const,
  };
}

export function isRedirectUriRegistered(
  redirectUri: string,
  registeredRedirectUris: readonly string[],
) {
  return registeredRedirectUris.includes(redirectUri);
}

export function hasRegisteredRedirectUri(
  client: Pick<RegisteredOauthClient, "redirectUris">,
  redirectUri: string,
) {
  return isRedirectUriRegistered(redirectUri.trim(), client.redirectUris);
}

export function createOAuthClientId() {
  return `alex_client_${randomToken(18)}`;
}

export const generateOauthClientId = createOAuthClientId;

export function mapOauthClientRow(row: unknown): RegisteredOauthClient | null {
  if (
    !row ||
    typeof row !== "object" ||
    !("client_id" in row) ||
    !("client_name" in row) ||
    !("redirect_uris" in row) ||
    typeof row.client_id !== "string" ||
    typeof row.client_name !== "string" ||
    !Array.isArray(row.redirect_uris) ||
    !row.redirect_uris.every((uri): uri is string => typeof uri === "string")
  ) {
    return null;
  }

  return {
    clientId: row.client_id,
    clientName: row.client_name,
    redirectUris: row.redirect_uris,
  };
}
