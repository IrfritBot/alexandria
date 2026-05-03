import { validateMcpBearerToken } from "../../../lib/mcp/api-keys";

export const dynamic = "force-dynamic";

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

function notImplementedResponse() {
  return Response.json(
    {
      ok: false,
      service: "alexandria",
      surface: "mcp",
      status: "not_implemented",
      message:
        "MCP transport and memory tools are intentionally stubbed for Sprint 1A.",
    },
    { status: 501 },
  );
}

export async function GET(request: Request) {
  const mcpAuth = await validateMcpBearerToken(request);

  if (!mcpAuth.ok) {
    return unauthorizedResponse();
  }

  return notImplementedResponse();
}

export async function POST(request: Request) {
  return GET(request);
}
