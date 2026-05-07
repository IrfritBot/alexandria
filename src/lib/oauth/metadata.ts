import { OAUTH_SCOPES } from "./scopes";

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function oauthBaseUrl(request: Request) {
  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (configuredAppUrl) {
    return stripTrailingSlash(new URL(configuredAppUrl).origin);
  }

  return new URL(request.url).origin;
}

export function oauthUrl(request: Request, path: string) {
  return `${oauthBaseUrl(request)}${path}`;
}

export function protectedResourceMetadata(request: Request) {
  const baseUrl = oauthBaseUrl(request);

  return {
    authorization_servers: [baseUrl],
    resource: `${baseUrl}/api/mcp`,
    scopes_supported: OAUTH_SCOPES,
  };
}

export const buildProtectedResourceMetadata = protectedResourceMetadata;

export function authorizationServerMetadata(request: Request) {
  const baseUrl = oauthBaseUrl(request);

  return {
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    code_challenge_methods_supported: ["S256"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    issuer: baseUrl,
    registration_endpoint: `${baseUrl}/oauth/register`,
    response_types_supported: ["code"],
    scopes_supported: OAUTH_SCOPES,
    token_endpoint: `${baseUrl}/oauth/token`,
    token_endpoint_auth_methods_supported: ["none"],
  };
}

export const buildAuthorizationServerMetadata = authorizationServerMetadata;

export function mcpWwwAuthenticateHeader(request: Request) {
  return `Bearer resource_metadata="${oauthUrl(
    request,
    "/.well-known/oauth-protected-resource",
  )}"`;
}

export function protectedResourceMetadataUrl(request: Request) {
  return oauthUrl(request, "/.well-known/oauth-protected-resource");
}
