export const OAUTH_SCOPES = ["memory:read", "memory:write"] as const;
export const ALLOWED_OAUTH_SCOPES = OAUTH_SCOPES;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];
export type OauthScope = OAuthScope;

const OAUTH_SCOPE_SET = new Set<string>(OAUTH_SCOPES);

export type ParseScopesResult =
  | {
      ok: true;
      scopes: OAuthScope[];
    }
  | {
      ok: false;
      invalidScope: string;
    };

export function isOAuthScope(scope: string): scope is OAuthScope {
  return OAUTH_SCOPE_SET.has(scope);
}

export const isOauthScope = isOAuthScope;

export function normalizeOAuthScopes(scopes: readonly string[]) {
  const requested = new Set(scopes);

  return OAUTH_SCOPES.filter((scope) => requested.has(scope));
}

export function parseOAuthScopes(scope: string | null | undefined): ParseScopesResult {
  if (!scope || scope.trim().length === 0) {
    return { ok: true, scopes: [...OAUTH_SCOPES] };
  }

  const seen = new Set<string>();

  for (const rawScope of scope.trim().split(/\s+/)) {
    if (!isOAuthScope(rawScope)) {
      return { ok: false, invalidScope: rawScope };
    }

    seen.add(rawScope);
  }

  return { ok: true, scopes: normalizeOAuthScopes([...seen]) };
}

export function parseOauthScopes(scope: string | null | undefined) {
  const result = parseOAuthScopes(scope);

  if (result.ok) {
    return result;
  }

  return { ok: false as const, invalidScopes: [result.invalidScope] };
}

export function serializeOAuthScopes(scopes: readonly string[]) {
  return normalizeOAuthScopes(scopes).join(" ");
}

export const formatOauthScopes = serializeOAuthScopes;

export function hasScope(
  session: { authKind?: "api_key" | "oauth"; scopes?: readonly string[] },
  scope: OAuthScope,
) {
  if (session.authKind !== "oauth") {
    return true;
  }

  return session.scopes?.includes(scope) ?? false;
}
