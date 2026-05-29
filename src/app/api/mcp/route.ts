import { validateMcpBearerToken } from "../../../lib/mcp/api-key-validation";
import type { ValidMcpSession } from "../../../lib/mcp/api-keys";
import { mcpWwwAuthenticateHeader } from "../../../lib/oauth/metadata";
import { hasScope } from "../../../lib/oauth/scopes";
import {
  saveMcpMemory,
  type MemorySaveField,
} from "../../../lib/mcp/memory-save";
import {
  getMcpMemory,
  recallRecentMcpMemories,
  searchMcpMemories,
  type MemoryReadField,
} from "../../../lib/mcp/memory-read";
import {
  getMcpPrompt,
  isMcpPromptName,
  isMcpToolName,
  MCP_PROMPTS,
  MCP_SERVER_INSTRUCTIONS,
  MCP_TOOLS,
  type McpToolName,
} from "../../../lib/mcp/tool-descriptions";

export const dynamic = "force-dynamic";

const JSON_RPC_VERSION = "2.0";
const MCP_PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = {
  name: "alexandria",
  title: "Alexandria",
  version: "0.1.0",
};

type JsonRpcId = string | number | null;

type JsonBodyResult =
  | {
      ok: true;
      body: unknown;
    }
  | {
      ok: false;
      reason: "invalid_json";
    };

type McpCall =
  | {
      ok: true;
      toolName: McpToolName;
      params: unknown;
    }
  | {
      ok: false;
      reason: "tool_list" | "unsupported_method";
    };

type ToolExecutionResult = {
  body: Record<string, unknown>;
  isError: boolean;
  status: number;
};

function unauthorizedResponse(request: Request) {
  return Response.json(
    {
      ok: false,
      service: "alexandria",
      surface: "mcp",
      error: "invalid_mcp_key",
    },
    {
      headers: {
        "www-authenticate": mcpWwwAuthenticateHeader(request),
      },
      status: 401,
    },
  );
}

function unauthorizedBody() {
  return {
    ok: false,
    service: "alexandria",
    surface: "mcp",
    error: "invalid_mcp_key",
  };
}

function insufficientScopeBody() {
  return {
    ok: false,
    service: "alexandria",
    surface: "mcp",
    error: "insufficient_scope",
  };
}

function toolListBody() {
  return {
    ok: true,
    service: "alexandria",
    surface: "mcp",
    tools: MCP_TOOLS,
  };
}

function toolListResponse() {
  return Response.json(toolListBody());
}

function notImplementedResponse(message = "MCP method is not implemented.") {
  return Response.json(legacyNotImplementedBody(message), { status: 501 });
}

function invalidInputResponse(field: MemorySaveField) {
  return Response.json(invalidToolInputBody(field), { status: 400 });
}

function legacyNotImplementedBody(message = "MCP method is not implemented.") {
  return {
    ok: false,
    service: "alexandria",
    surface: "mcp",
    status: "not_implemented",
    message,
  };
}

function invalidToolInputBody(field: MemorySaveField | MemoryReadField) {
  return {
    ok: false,
    service: "alexandria",
    surface: "mcp",
    error: "invalid_input",
    field,
  };
}

function toolFailedBody(method: McpToolName) {
  return {
    ok: false,
    service: "alexandria",
    surface: "mcp",
    error: `${method}_failed`,
  };
}

function memoryNotFoundBody() {
  return {
    ok: false,
    service: "alexandria",
    surface: "mcp",
    error: "memory_not_found",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parseJsonBody(request: Request): Promise<JsonBodyResult> {
  try {
    return { body: await request.json(), ok: true };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}

function parseLegacyMcpCall(body: unknown): McpCall {
  if (!isRecord(body)) {
    return { ok: false, reason: "unsupported_method" };
  }

  if (body.method === "tools/list") {
    return { ok: false, reason: "tool_list" };
  }

  if (isMcpToolName(body.method)) {
    return {
      ok: true,
      toolName: body.method,
      params:
        isRecord(body.params) || Array.isArray(body.params)
          ? body.params
          : body,
    };
  }

  if (body.method === "tools/call" && isRecord(body.params)) {
    if (!isMcpToolName(body.params.name)) {
      return { ok: false, reason: "unsupported_method" };
    }

    return {
      ok: true,
      toolName: body.params.name,
      params: isRecord(body.params.arguments) ? body.params.arguments : {},
    };
  }

  if (isMcpToolName(body.tool)) {
    return {
      ok: true,
      toolName: body.tool,
      params: isRecord(body.arguments) ? body.arguments : body,
    };
  }

  return { ok: false, reason: "unsupported_method" };
}

function hasOwnProperty(
  value: Record<string, unknown>,
  property: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(value, property);
}

function isJsonRpcRequest(body: unknown): body is Record<string, unknown> {
  return isRecord(body) && hasOwnProperty(body, "jsonrpc");
}

function getJsonRpcId(body: Record<string, unknown>): JsonRpcId {
  if (!hasOwnProperty(body, "id")) {
    return null;
  }

  if (
    typeof body.id === "string" ||
    typeof body.id === "number" ||
    body.id === null
  ) {
    return body.id;
  }

  return null;
}

function hasJsonRpcId(body: Record<string, unknown>) {
  return hasOwnProperty(body, "id");
}

function jsonRpcResult(id: JsonRpcId, result: unknown) {
  return Response.json({
    jsonrpc: JSON_RPC_VERSION,
    id,
    result,
  });
}

function jsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
) {
  return Response.json({
    jsonrpc: JSON_RPC_VERSION,
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  });
}

function negotiateProtocolVersion(params: unknown) {
  if (
    isRecord(params) &&
    typeof params.protocolVersion === "string" &&
    params.protocolVersion.trim().length > 0
  ) {
    return params.protocolVersion.trim();
  }

  return MCP_PROTOCOL_VERSION;
}

function initializeResult(params: unknown) {
  return {
    protocolVersion: negotiateProtocolVersion(params),
    capabilities: {
      prompts: {
        listChanged: false,
      },
      tools: {
        listChanged: false,
      },
    },
    instructions: MCP_SERVER_INSTRUCTIONS,
    serverInfo: SERVER_INFO,
  };
}

function jsonRpcToolContent(result: ToolExecutionResult) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result.body, null, 2),
      },
    ],
    ...(result.isError ? { isError: true } : {}),
  };
}

function legacyToolResponse(request: Request, result: ToolExecutionResult) {
  if (result.status === 401) {
    return Response.json(result.body, {
      headers: {
        "www-authenticate": mcpWwwAuthenticateHeader(request),
      },
      status: result.status,
    });
  }

  return Response.json(result.body, { status: result.status });
}

async function executeMcpTool(
  session: ValidMcpSession,
  call: Extract<McpCall, { ok: true }>,
): Promise<ToolExecutionResult> {
  if (call.toolName === "memory_save") {
    if (!hasScope(session, "memory:write")) {
      return {
        body: insufficientScopeBody(),
        isError: true,
        status: 403,
      };
    }

    const result = await saveMcpMemory(call.params, session);

    if (result.ok) {
      return {
        body: {
          ok: true,
          service: "alexandria",
          surface: "mcp",
          method: "memory_save",
          memory_id: result.memoryId,
          status: result.status,
          message: result.message,
        },
        isError: false,
        status: 202,
      };
    }

    if (result.reason === "invalid_input") {
      return {
        body: invalidToolInputBody(result.field ?? "content"),
        isError: true,
        status: 400,
      };
    }

    if (result.reason === "invalid_mcp_session") {
      return {
        body: unauthorizedBody(),
        isError: true,
        status: 401,
      };
    }

    return {
      body: toolFailedBody("memory_save"),
      isError: true,
      status: 500,
    };
  }

  if (call.toolName === "memory_search") {
    if (!hasScope(session, "memory:read")) {
      return {
        body: insufficientScopeBody(),
        isError: true,
        status: 403,
      };
    }

    const result = await searchMcpMemories(call.params, session);

    if (result.ok) {
      return {
        body: {
          ok: true,
          service: "alexandria",
          surface: "mcp",
          method: "memory_search",
          memories: result.memories,
          total: result.total,
        },
        isError: false,
        status: 200,
      };
    }

    if (result.reason === "invalid_input") {
      return {
        body: invalidToolInputBody(result.field ?? "query"),
        isError: true,
        status: 400,
      };
    }

    if (result.reason === "invalid_mcp_session") {
      return {
        body: unauthorizedBody(),
        isError: true,
        status: 401,
      };
    }

    return {
      body: toolFailedBody("memory_search"),
      isError: true,
      status: 500,
    };
  }

  if (call.toolName === "memory_recall_recent") {
    if (!hasScope(session, "memory:read")) {
      return {
        body: insufficientScopeBody(),
        isError: true,
        status: 403,
      };
    }

    const result = await recallRecentMcpMemories(call.params, session);

    if (result.ok) {
      return {
        body: {
          ok: true,
          service: "alexandria",
          surface: "mcp",
          method: "memory_recall_recent",
          memories: result.memories,
        },
        isError: false,
        status: 200,
      };
    }

    if (result.reason === "invalid_input") {
      return {
        body: invalidToolInputBody(result.field ?? "limit"),
        isError: true,
        status: 400,
      };
    }

    if (result.reason === "invalid_mcp_session") {
      return {
        body: unauthorizedBody(),
        isError: true,
        status: 401,
      };
    }

    return {
      body: toolFailedBody("memory_recall_recent"),
      isError: true,
      status: 500,
    };
  }

  if (!hasScope(session, "memory:read")) {
    return {
      body: insufficientScopeBody(),
      isError: true,
      status: 403,
    };
  }

  const result = await getMcpMemory(call.params, session);

  if (result.ok) {
    return {
      body: {
        ok: true,
        service: "alexandria",
        surface: "mcp",
        method: "memory_get",
        ...result.memory,
      },
      isError: false,
      status: 200,
    };
  }

  if (result.reason === "not_found") {
    return {
      body: memoryNotFoundBody(),
      isError: true,
      status: 404,
    };
  }

  if (result.reason === "invalid_input") {
    return {
      body: invalidToolInputBody(result.field ?? "memory_id"),
      isError: true,
      status: 400,
    };
  }

  if (result.reason === "invalid_mcp_session") {
    return {
      body: unauthorizedBody(),
      isError: true,
      status: 401,
    };
  }

  return {
    body: toolFailedBody("memory_get"),
    isError: true,
    status: 500,
  };
}

async function handleJsonRpcRequest(
  session: ValidMcpSession,
  body: Record<string, unknown>,
) {
  const id = getJsonRpcId(body);

  if (body.jsonrpc !== JSON_RPC_VERSION) {
    return jsonRpcError(id, -32600, "Invalid Request.");
  }

  if (typeof body.method !== "string") {
    return jsonRpcError(id, -32600, "Invalid Request.");
  }

  if (!hasJsonRpcId(body)) {
    return new Response(null, { status: 204 });
  }

  if (body.method === "initialize") {
    return jsonRpcResult(id, initializeResult(body.params));
  }

  if (
    body.method === "notifications/initialized" ||
    body.method === "initialized"
  ) {
    return jsonRpcResult(id, {});
  }

  if (body.method === "ping") {
    return jsonRpcResult(id, {});
  }

  if (body.method === "tools/list") {
    return jsonRpcResult(id, {
      tools: MCP_TOOLS,
    });
  }

  if (body.method === "prompts/list") {
    return jsonRpcResult(id, {
      prompts: MCP_PROMPTS,
    });
  }

  if (body.method === "prompts/get") {
    if (!isRecord(body.params) || typeof body.params.name !== "string") {
      return jsonRpcError(id, -32602, "Invalid params.");
    }

    if (!isMcpPromptName(body.params.name)) {
      return jsonRpcError(id, -32602, "Unknown prompt.", {
        name: body.params.name,
      });
    }

    return jsonRpcResult(id, getMcpPrompt(body.params.name));
  }

  if (body.method === "tools/call") {
    if (!isRecord(body.params) || typeof body.params.name !== "string") {
      return jsonRpcError(id, -32602, "Invalid params.");
    }

    if (!isMcpToolName(body.params.name)) {
      return jsonRpcError(id, -32602, "Unknown tool.", {
        name: body.params.name,
      });
    }

    const toolArguments =
      body.params.arguments === undefined ? {} : body.params.arguments;

    if (!isRecord(toolArguments)) {
      return jsonRpcError(id, -32602, "Invalid params.");
    }

    const result = await executeMcpTool(session, {
      ok: true,
      params: toolArguments,
      toolName: body.params.name,
    });

    return jsonRpcResult(id, jsonRpcToolContent(result));
  }

  if (isMcpToolName(body.method)) {
    const result = await executeMcpTool(session, {
      ok: true,
      params:
        isRecord(body.params) || Array.isArray(body.params)
          ? body.params
          : {},
      toolName: body.method,
    });

    return jsonRpcResult(id, jsonRpcToolContent(result));
  }

  return jsonRpcError(id, -32601, "Method not found.");
}

export async function GET(request: Request) {
  const mcpAuth = await validateMcpBearerToken(request);

  if (!mcpAuth.ok) {
    return unauthorizedResponse(request);
  }

  return toolListResponse();
}

export async function POST(request: Request) {
  const mcpAuth = await validateMcpBearerToken(request);

  if (!mcpAuth.ok) {
    return unauthorizedResponse(request);
  }

  const parsedBody = await parseJsonBody(request);

  if (!parsedBody.ok) {
    return invalidInputResponse("content");
  }

  if (isJsonRpcRequest(parsedBody.body)) {
    return handleJsonRpcRequest(mcpAuth.session, parsedBody.body);
  }

  const call = parseLegacyMcpCall(parsedBody.body);

  if (!call.ok) {
    if (call.reason === "tool_list") {
      return toolListResponse();
    }

    return notImplementedResponse();
  }

  return legacyToolResponse(
    request,
    await executeMcpTool(mcpAuth.session, call),
  );
}
