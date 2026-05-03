import { validateMcpBearerToken } from "../../../lib/mcp/api-keys";
import {
  saveMcpMemory,
  type MemorySaveField,
} from "../../../lib/mcp/memory-save";

export const dynamic = "force-dynamic";

type McpCall =
  | {
      ok: true;
      params: unknown;
    }
  | {
      ok: false;
      reason: "invalid_json" | "unsupported_method";
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

function saveFailedResponse() {
  return Response.json(
    {
      ok: false,
      service: "alexandria",
      surface: "mcp",
      error: "memory_save_failed",
    },
    { status: 500 },
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

  if (body.method === "memory_save") {
    return {
      ok: true,
      params:
        isRecord(body.params) || Array.isArray(body.params)
          ? body.params
          : body,
    };
  }

  if (body.method === "tools/call" && isRecord(body.params)) {
    if (body.params.name !== "memory_save") {
      return { ok: false, reason: "unsupported_method" };
    }

    return {
      ok: true,
      params: isRecord(body.params.arguments) ? body.params.arguments : {},
    };
  }

  if (body.tool === "memory_save") {
    return {
      ok: true,
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

  return notImplementedResponse(
    "MCP GET discovery is not implemented yet.",
  );
}

export async function POST(request: Request) {
  const mcpAuth = await validateMcpBearerToken(request);

  if (!mcpAuth.ok) {
    return unauthorizedResponse();
  }

  const call = await parseMcpCall(request);

  if (!call.ok) {
    if (call.reason === "invalid_json") {
      return invalidInputResponse("content");
    }

    return notImplementedResponse();
  }

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
    return invalidInputResponse(result.field ?? "content");
  }

  if (result.reason === "invalid_mcp_session") {
    return unauthorizedResponse();
  }

  return saveFailedResponse();
}
