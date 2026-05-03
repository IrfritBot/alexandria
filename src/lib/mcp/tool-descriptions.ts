export const MEMORY_SAVE_DESCRIPTION = `Save a durable fact, decision, or piece of team knowledge to the shared
company knowledge base. The KB is shared across the team and persists across
all conversations and LLM clients.

CALL THIS TOOL PROACTIVELY when the user:
1. Shares a fact about a client, project, vendor, or operational detail
   (e.g., "their domain renews June 2", "this client uses Shopify").
2. Makes a decision worth preserving ("we're going with Plan B",
   "the new pricing is X").
3. Explicitly says "remember this", "save this", "log this", or similar.

DO NOT CALL THIS TOOL for:
- Transient context, in-progress thinking, or speculation.
- Information clearly only relevant to the current conversation.
- Personal details unrelated to the team's work.
- Hypotheticals or "what if" scenarios.

When in doubt, ask the user before saving.

The system automatically classifies the kind (policy / fact / judgment),
detects conflicts with existing memories, and surfaces unresolved conflicts
to admins. Tags should be specific — prefer "client/ashley-stambouli" over
just "client". Multiple tags encouraged.

Returns: confirmation message and memory ID. Classification and conflict
detection happen asynchronously; the response will not include kind or
conflict_id (look in the web UI for those once processing completes).`;

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

export const MCP_TOOL_NAMES = [
  "memory_save",
  "memory_search",
  "memory_recall_recent",
  "memory_get",
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

type JsonSchema = {
  additionalProperties?: boolean;
  properties: Record<string, unknown>;
  required?: string[];
  type: "object";
};

export type McpToolDefinition = {
  description: string;
  inputSchema: JsonSchema;
  name: McpToolName;
};

export const MCP_TOOLS: McpToolDefinition[] = [
  {
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

export function isMcpToolName(value: unknown): value is McpToolName {
  return MCP_TOOL_NAMES.some((toolName) => toolName === value);
}
