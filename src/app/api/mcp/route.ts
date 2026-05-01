export const dynamic = "force-dynamic";

export async function GET() {
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

export async function POST() {
  return GET();
}
