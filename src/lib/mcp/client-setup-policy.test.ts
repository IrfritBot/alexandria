import { describe, expect, it } from "vitest";

import {
  CLIENT_SETUP_POLICIES,
  mcpConnectionDetails,
} from "./client-setup-policy";

describe("client setup policy", () => {
  it("includes setup blocks for common client rule systems", () => {
    expect(CLIENT_SETUP_POLICIES.map((policy) => policy.clientName)).toEqual([
      "Claude",
      "Cursor",
      "Codex",
      "Generic MCP client",
    ]);
    expect(CLIENT_SETUP_POLICIES.map((policy) => policy.placement)).toEqual([
      "Project instructions or custom instructions",
      "Cursor rules",
      "Agent instructions",
      "System prompt or workspace instructions",
    ]);
  });

  it("tells clients when to search, save, ask, and ignore", () => {
    for (const policy of CLIENT_SETUP_POLICIES) {
      expect(policy.body).toContain("At the start of a conversation");
      expect(policy.body).toContain("memory_search");
      expect(policy.body).toContain("memory_recall_recent");
      expect(policy.body).toContain("Save durable work facts proactively");
      expect(policy.body).toContain("Ask before saving");
      expect(policy.body).toContain("Do not save current-task scratchpad");
      expect(policy.body).toContain("secrets, tokens, credentials");
      expect(policy.body).toContain("speculation, brainstorming");
      expect(policy.body).toContain("classification, conflict detection");
    }
  });

  it("builds OAuth remote MCP connection details without manual key material", () => {
    expect(mcpConnectionDetails("https://alexandria.example")).toEqual({
      authorizationServerMetadataUrl:
        "https://alexandria.example/.well-known/oauth-authorization-server",
      mcpServerUrl: "https://alexandria.example/api/mcp",
      protectedResourceMetadataUrl:
        "https://alexandria.example/.well-known/oauth-protected-resource",
      scopes: ["memory:read", "memory:write"],
    });
  });
});
