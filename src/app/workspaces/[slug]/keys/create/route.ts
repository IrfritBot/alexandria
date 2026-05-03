import { NextResponse } from "next/server";

import { issueMcpKey } from "@/lib/mcp/api-keys";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  isWorkspaceAdmin,
  loadWorkspaceContext,
} from "@/lib/web/workspace-context";

export const dynamic = "force-dynamic";

type CreateKeyRouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

function redirectTo(request: Request, path: string) {
  return NextResponse.redirect(new URL(path, request.url), 303);
}

function keysPath(slug: string, suffix = "") {
  return `/workspaces/${slug}/keys${suffix}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
    },
    status,
  });
}

function forbiddenHtml(slug: string) {
  return htmlResponse(
    `<!doctype html><html><body><main><h1>Admin access required</h1><p>MCP key management is available to workspace admins only.</p><p><a href="${escapeHtml(
      keysPath(slug),
    )}">Back to MCP keys</a></p></main></body></html>`,
    403,
  );
}

function createdKeyHtml(input: {
  apiKey: string;
  keyName: string;
  keyPrefix: string;
  slug: string;
}) {
  return htmlResponse(`<!doctype html>
<html lang="en">
  <head>
    <meta name="robots" content="noindex" />
    <title>MCP key created</title>
    <style>
      body { background: #f8faf9; color: #17211d; font-family: Arial, Helvetica, sans-serif; margin: 0; }
      main { display: grid; gap: 16px; margin: 0 auto; max-width: 760px; padding: 32px 24px; }
      input { border: 1px solid #cdd7d2; border-radius: 8px; font: inherit; padding: 10px; width: 100%; }
      a { color: #173f35; font-weight: 700; }
      .box { background: #ffffff; border: 1px solid #77b99e; border-radius: 8px; padding: 16px; }
    </style>
  </head>
  <body>
    <main>
      <p><a href="${escapeHtml(keysPath(input.slug))}">Back to MCP keys</a></p>
      <div class="box">
        <h1>MCP key created</h1>
        <p>${escapeHtml(input.keyName)} is ready. This value is shown once.</p>
        <label for="api-key">API key</label>
        <input id="api-key" readonly value="${escapeHtml(input.apiKey)}" />
        <p>Prefix: ${escapeHtml(input.keyPrefix)}</p>
      </div>
    </main>
  </body>
</html>`);
}

export async function POST(request: Request, context: CreateKeyRouteContext) {
  const { slug } = await context.params;
  const supabase = await createSupabaseServerClient();
  const workspaceResult = await loadWorkspaceContext({ slug }, supabase);

  if (!workspaceResult.ok) {
    if (workspaceResult.reason === "unauthenticated") {
      return redirectTo(
        request,
        `/login?next=${encodeURIComponent(keysPath(slug))}`,
      );
    }

    return htmlResponse("Workspace not found.", 404);
  }

  if (!isWorkspaceAdmin(workspaceResult.context)) {
    return forbiddenHtml(slug);
  }

  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim();
  const result = await issueMcpKey(
    {
      name,
      workspaceId: workspaceResult.context.workspace.id,
    },
    supabase as never,
  );

  if (!result.ok) {
    if (result.reason === "forbidden") {
      return forbiddenHtml(slug);
    }

    return redirectTo(request, keysPath(slug, "?error=create"));
  }

  return createdKeyHtml({
    apiKey: result.key.apiKey,
    keyName: result.key.name,
    keyPrefix: result.key.keyPrefix,
    slug,
  });
}
