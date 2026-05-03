import { validateMcpBearerToken } from "../../../lib/mcp/api-keys";
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
  isMcpToolName,
  MCP_TOOLS,
  type McpToolName,
} from "../../../lib/mcp/tool-descriptions";

export const dynamic = "force-dynamic";

type McpCall =
  | {
      ok: true;
      toolName: McpToolName;
      params: unknown;
    }
  | {
      ok: false;
      reason: "invalid_json" | "tool_list" | "unsupported_method";
    };

function unauthorizedResponse() {
  return Response.json(
    {
      ok: false,
      service: "alexandria",
      surface: "mcp",
      error: "invalid_mcp_key",
    },
    {
      headers: {
        "www-authenticate": "Bearer",
      },
      status: 401,
    },
  );
}

function toolListResponse() {
  return Response.json({
    ok: true,
    service: "alexandria",
    surface: "mcp",
    tools: MCP_TOOLS,
  });
}

function notImplementedResponse(message = "MCP method is not implemented.") {
  return Response.json(
    {
      ok: false,
      service: "alexandria",
      surface: "mcp",
      status: "not_implemented",
      message,
    },
    { status: 501 },
  );
}

function invalidInputResponse(field: MemorySaveField) {
  return Response.json(
    {
      ok: false,
      service: "alexandria",
      surface: "mcp",
      error: "invalid_input",
      field,
    },
    { status: 400 },
  );
}

function invalidToolInputResponse(field: MemorySaveField | MemoryReadField) {
  return Response.json(
    {
      ok: false,
      service: "alexandria",
      surface: "mcp",
      error: "invalid_input",
      field,
    },
    { status: 400 },
  );
}

function toolFailedResponse(method: McpToolName) {
  return Response.json(
    {
      ok: false,
      service: "alexandria",
      surface: "mcp",
      error: `${method}_failed`,
    },
    { status: 500 },
  );
}

function memoryNotFoundResponse() {
  return Response.json(
    {
      ok: false,
      service: "alexandria",
      surface: "mcp",
      error: "memory_not_found",
    },
    { status: 404 },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parseMcpCall(request: Request): Promise<McpCall> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

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

export async function GET(request: Request) {
  const mcpAuth = await validateMcpBearerToken(request);

  if (!mcpAuth.ok) {
    return unauthorizedResponse();
  }

  return toolListResponse();
}

export async function POST(request: Request) {
  const mcpAuth = await validateMcpBearerToken(request);

  if (!mcpAuth.ok) {
    return unauthorizedResponse();
  }

  const call = await parseMcpCall(request);

  if (!call.ok) {
    if (call.reason === "tool_list") {
      return toolListResponse();
    }

    if (call.reason === "invalid_json") {
      return invalidInputResponse("content");
    }

    return notImplementedResponse();
  }

  if (call.toolName === "memory_save") {
    const result = await saveMcpMemory(call.params, mcpAuth.session);

    if (result.ok) {
      return Response.json(
        {
          ok: true,
          service: "alexandria",
          surface: "mcp",
          method: "memory_save",
          memory_id: result.memoryId,
          status: result.status,
          message: result.message,
        },
        { status: 202 },
      );
    }

    if (result.reason === "invalid_input") {
      return invalidToolInputResponse(result.field ?? "content");
    }

    if (result.reason === "invalid_mcp_session") {
      return unauthorizedResponse();
    }

    return toolFailedResponse("memory_save");
  }

  if (call.toolName === "memory_search") {
    const result = await searchMcpMemories(call.params, mcpAuth.session);

    if (result.ok) {
      return Response.json({
        ok: true,
        service: "alexandria",
        surface: "mcp",
        method: "memory_search",
        memories: result.memories,
        total: result.total,
      });
    }

    if (result.reason === "invalid_input") {
      return invalidToolInputResponse(result.field ?? "query");
    }

    if (result.reason === "invalid_mcp_session") {
      return unauthorizedResponse();
    }

    return toolFailedResponse("memory_search");
  }

  if (call.toolName === "memory_recall_recent") {
    const result = await recallRecentMcpMemories(call.params, mcpAuth.session);

    if (result.ok) {
      return Response.json({
        ok: true,
        service: "alexandria",
        surface: "mcp",
        method: "memory_recall_recent",
        memories: result.memories,
      });
    }

    if (result.reason === "invalid_input") {
      return invalidToolInputResponse(result.field ?? "limit");
    }

    if (result.reason === "invalid_mcp_session") {
      return unauthorizedResponse();
    }

    return toolFailedResponse("memory_recall_recent");
  }

  const result = await getMcpMemory(call.params, mcpAuth.session);

  if (result.ok) {
    return Response.json({
      ok: true,
      service: "alexandria",
      surface: "mcp",
      method: "memory_get",
      ...result.memory,
    });
  }

  if (result.reason === "not_found") {
    return memoryNotFoundResponse();
  }

  if (result.reason === "invalid_input") {
    return invalidToolInputResponse(result.field ?? "memory_id");
  }

  if (result.reason === "invalid_mcp_session") {
    return unauthorizedResponse();
  }

  return toolFailedResponse("memory_get");
}
