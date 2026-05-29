export type ClientSetupPolicy = {
  body: string;
  clientName: string;
  id: "claude" | "cursor" | "codex" | "generic";
  placement: string;
};

export type McpConnectionDetails = {
  authorizationServerMetadataUrl: string;
  mcpServerUrl: string;
  protectedResourceMetadataUrl: string;
  scopes: string[];
};

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function alexandriaAppBaseUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (!configuredUrl) {
    return "";
  }

  return stripTrailingSlash(new URL(configuredUrl).origin);
}

function appUrl(path: string, baseUrl = alexandriaAppBaseUrl()) {
  return `${baseUrl}${path}`;
}

export function mcpConnectionDetails(
  baseUrl = alexandriaAppBaseUrl(),
): McpConnectionDetails {
  return {
    authorizationServerMetadataUrl: appUrl(
      "/.well-known/oauth-authorization-server",
      baseUrl,
    ),
    mcpServerUrl: appUrl("/api/mcp", baseUrl),
    protectedResourceMetadataUrl: appUrl(
      "/.well-known/oauth-protected-resource",
      baseUrl,
    ),
    scopes: ["memory:read", "memory:write"],
  };
}

const sharedPolicy = `Use Alexandria as governed team memory.

At the start of a conversation, call memory_search when the user mentions a client, project, vendor, internal process, or topic that may already have workspace context. If the user asks for the latest context without a specific topic, call memory_recall_recent.

Save durable work facts proactively with memory_save when they would help a future teammate or agent: customer/client/vendor facts, decisions, policies, constraints, preferences, project history, and stable operational details.

Ask before saving ambiguous personal information, private or sensitive facts, external-customer details that may be confidential, speculation, brainstorming, or unvalidated claims.

Do not save current-task scratchpad, one-off instructions, secrets, tokens, credentials, private keys, session cookies, or private medical/legal/financial data by default.

Saved memories still go through Alexandria classification, conflict detection, audit logging, and review.`;

export const CLIENT_SETUP_POLICIES: ClientSetupPolicy[] = [
  {
    body: sharedPolicy,
    clientName: "Claude",
    id: "claude",
    placement: "Project instructions or custom instructions",
  },
  {
    body: `# Alexandria memory policy

${sharedPolicy}`,
    clientName: "Cursor",
    id: "cursor",
    placement: "Cursor rules",
  },
  {
    body: sharedPolicy,
    clientName: "Codex",
    id: "codex",
    placement: "Agent instructions",
  },
  {
    body: sharedPolicy,
    clientName: "Generic MCP client",
    id: "generic",
    placement: "System prompt or workspace instructions",
  },
];
