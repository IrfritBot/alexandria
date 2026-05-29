export const MEMORY_SAVE_DESCRIPTION = `Save durable team knowledge to Alexandria's shared memory layer. Saved memory
persists across conversations and LLM clients, is visible to the workspace
according to governance rules, and goes through classification, conflict
detection, audit logging, and review.

SAVE AUTOMATICALLY when the user shares durable work context that would help a
future teammate or agent, including:
1. Customer, client, vendor, or partner facts that are stable and work-relevant.
2. Decisions, policies, constraints, preferences, and project history.
3. Stable operational details such as renewal dates, technical stack choices,
   ownership, rollout plans, recurring process rules, or support expectations.
4. Explicit requests such as "remember this", "save this", "log this", or
   equivalent wording.

ASK FIRST before saving:
- Ambiguous personal information, even if it appears work-adjacent.
- Private or sensitive facts, including external-customer details that may be
  confidential.
- Speculation, brainstorming, hypotheses, or unvalidated claims.
- Anything where the user may reasonably expect the information to stay only in
  the current conversation.

DO NOT SAVE:
- Current-task scratchpad notes, temporary chain-of-thought, drafts, or
  intermediate reasoning.
- One-off instructions, formatting preferences, or ephemeral requests that only
  apply to this conversation.
- Secrets, tokens, credentials, private keys, session cookies, or recovery codes.
- Private medical, legal, financial, or other sensitive personal data by default.

When in doubt, ask the user before saving.

Tags should be specific, such as "client/ashley-stambouli" rather than just
"client". Multiple tags are encouraged.

Returns: confirmation message and memory ID. Classification and conflict
detection happen asynchronously; the response will not include kind or
conflict_id.`;

export const MEMORY_SEARCH_DESCRIPTION = `Search the shared company knowledge base for memories relevant to a query.
Returns memories with content, metadata, and a relevance score.

CALL THIS TOOL PROACTIVELY at the start of any conversation about a
client, project, vendor, or topic the team might already know about.
Search BEFORE answering questions to ground responses in current team
knowledge. Examples that should always trigger a search:

1. The user asks a question that team knowledge could answer ("what did
   we decide about X", "what does the team know about Y").
2. Before any non-trivial recommendation about an entity (client, project,
   internal process).
3. When the user mentions a name, project, or term that might have prior
   context.

Search uses hybrid retrieval: keyword + semantic + LLM reranking. Empty
results are a real signal — proceed without prior context, or ask the user.

Filters available: limit (default 10), kind, tags. Use them when a query
is broad. Searching for "Ashley Stambouli" with no filters is fine.

Returns: list of memories with content, kind, tags, author label, created_at,
and relevance score (0-1).`;

export const MEMORY_RECALL_RECENT_DESCRIPTION = `Fetch recently saved memories from the shared knowledge base, ordered by
save time (newest first). Use this for context bootstrapping when the user
hasn't given a specific topic.

CALL THIS when the user says things like "what's the latest", "catch me up",
"what's been going on", or when starting a session and you need to ground
in recent team activity without a specific search.

Less precise than memory_search — this is recency over relevance. Prefer
memory_search when you have a topic.

Returns: list of recent memories with metadata.`;

export const MEMORY_GET_DESCRIPTION = `Fetch a single memory by its ID. Use after memory_search returns a result
the user wants to expand on, or when referencing a memory by ID from
prior conversation.`;

export const MCP_SERVER_INSTRUCTIONS = `Alexandria is governed shared memory for durable team knowledge. At the start of a session, search memory when the user mentions a client, project, vendor, internal process, or topic that may already have workspace context. Save durable customer/client/vendor facts, decisions, policies, constraints, preferences, project history, and stable operational details when they would help a future teammate or agent. Ask before saving ambiguous personal information, private or sensitive facts, speculation, brainstorming, or unvalidated claims. Never save secrets, credentials, current-task scratchpad, one-off instructions, or private medical/legal/financial data by default. Alexandria cannot silently listen to arbitrary conversations; only use memory tools on context the client/user has chosen to share, and saved memories still go through classification, conflict detection, audit, and review.`;

export const MCP_TOOL_NAMES = [
  "memory_save",
  "memory_search",
  "memory_recall_recent",
  "memory_get",
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export const MCP_PROMPT_NAMES = [
  "alexandria_memory_policy",
  "alexandria_session_start",
  "alexandria_save_candidate",
] as const;

export type McpPromptName = (typeof MCP_PROMPT_NAMES)[number];

type JsonSchema = {
  additionalProperties?: boolean;
  properties: Record<string, unknown>;
  required?: string[];
  type: "object";
};

export type McpToolAnnotations = {
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  readOnlyHint?: boolean;
  title?: string;
};

export type McpToolDefinition = {
  annotations: McpToolAnnotations;
  description: string;
  inputSchema: JsonSchema;
  name: McpToolName;
};

export type McpPromptDefinition = {
  description: string;
  name: McpPromptName;
  title: string;
};

type McpPromptResult = {
  description: string;
  messages: Array<{
    content: {
      text: string;
      type: "text";
    };
    role: "user";
  }>;
};

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    annotations: {
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      readOnlyHint: false,
      title: "Save memory",
    },
    description: MEMORY_SAVE_DESCRIPTION,
    inputSchema: {
      additionalProperties: false,
      properties: {
        content: {
          description: "Memory content in markdown, up to 8K characters.",
          maxLength: 8192,
          minLength: 1,
          type: "string",
        },
        tags: {
          items: { type: "string" },
          type: "array",
        },
      },
      required: ["content"],
      type: "object",
    },
    name: "memory_save",
  },
  {
    annotations: {
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      readOnlyHint: true,
      title: "Search memory",
    },
    description: MEMORY_SEARCH_DESCRIPTION,
    inputSchema: {
      additionalProperties: false,
      properties: {
        kind: {
          enum: ["policy", "fact", "judgment"],
          type: "string",
        },
        limit: {
          default: 10,
          maximum: 50,
          minimum: 1,
          type: "integer",
        },
        query: {
          minLength: 1,
          type: "string",
        },
        tags: {
          items: { type: "string" },
          type: "array",
        },
      },
      required: ["query"],
      type: "object",
    },
    name: "memory_search",
  },
  {
    annotations: {
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      readOnlyHint: true,
      title: "Recall recent memories",
    },
    description: MEMORY_RECALL_RECENT_DESCRIPTION,
    inputSchema: {
      additionalProperties: false,
      properties: {
        author_profile_id: {
          format: "uuid",
          type: "string",
        },
        limit: {
          default: 20,
          maximum: 100,
          minimum: 1,
          type: "integer",
        },
        since: {
          format: "date-time",
          type: "string",
        },
      },
      type: "object",
    },
    name: "memory_recall_recent",
  },
  {
    annotations: {
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      readOnlyHint: true,
      title: "Get memory",
    },
    description: MEMORY_GET_DESCRIPTION,
    inputSchema: {
      additionalProperties: false,
      properties: {
        memory_id: {
          format: "uuid",
          type: "string",
        },
      },
      required: ["memory_id"],
      type: "object",
    },
    name: "memory_get",
  },
];

export const MCP_PROMPTS: McpPromptDefinition[] = [
  {
    description:
      "Apply Alexandria's governed memory search/save policy for this session.",
    name: "alexandria_memory_policy",
    title: "Alexandria Memory Policy",
  },
  {
    description:
      "Start a session by looking for relevant workspace memory before answering.",
    name: "alexandria_session_start",
    title: "Alexandria Session Start",
  },
  {
    description:
      "Decide whether a candidate fact should be saved, asked about, or ignored.",
    name: "alexandria_save_candidate",
    title: "Alexandria Save Candidate",
  },
];

const MCP_PROMPT_RESULTS: Record<McpPromptName, McpPromptResult> = {
  alexandria_memory_policy: {
    description: "Alexandria governed memory policy",
    messages: [
      {
        content: {
          text: MCP_SERVER_INSTRUCTIONS,
          type: "text",
        },
        role: "user",
      },
    ],
  },
  alexandria_session_start: {
    description: "Alexandria session-start memory lookup",
    messages: [
      {
        content: {
          text: "If the user mentions a client, project, vendor, internal process, or topic that may have workspace history, call memory_search before answering. If there is no specific topic but the user asks for recent context or a catch-up, call memory_recall_recent. Treat empty results as useful signal and continue without inventing prior context.",
          type: "text",
        },
        role: "user",
      },
    ],
  },
  alexandria_save_candidate: {
    description: "Alexandria save-candidate decision policy",
    messages: [
      {
        content: {
          text: "For a candidate memory, save durable work facts, decisions, policies, constraints, preferences, project history, and stable operational details that would help a future teammate or agent. Ask first for ambiguous personal information, private or sensitive facts, speculation, brainstorming, or unvalidated claims. Do not save current-task scratchpad, one-off instructions, secrets, credentials, or private medical/legal/financial data by default.",
          type: "text",
        },
        role: "user",
      },
    ],
  },
};

export function isMcpToolName(value: unknown): value is McpToolName {
  return MCP_TOOL_NAMES.some((toolName) => toolName === value);
}

export function isMcpPromptName(value: unknown): value is McpPromptName {
  return MCP_PROMPT_NAMES.some((promptName) => promptName === value);
}

export function getMcpPrompt(name: McpPromptName): McpPromptResult {
  return MCP_PROMPT_RESULTS[name];
}
