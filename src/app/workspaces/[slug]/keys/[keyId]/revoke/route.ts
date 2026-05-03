import { NextResponse } from "next/server";

import { revokeMcpKey } from "@/lib/mcp/api-keys";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validateMutationOrigin } from "@/lib/web/post-origin";
import {
  isWorkspaceAdmin,
  loadWorkspaceContext,
} from "@/lib/web/workspace-context";

export const dynamic = "force-dynamic";

type RevokeKeyRouteContext = {
  params: Promise<{
    keyId: string;
    slug: string;
  }>;
};

function keysPath(slug: string, suffix = "") {
  return `/workspaces/${slug}/keys${suffix}`;
}

function redirectTo(request: Request, path: string) {
  return NextResponse.redirect(new URL(path, request.url), 303);
}

function response(message: string, status: number) {
  return new Response(message, {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
    status,
  });
}

export async function POST(request: Request, context: RevokeKeyRouteContext) {
  const { keyId, slug } = await context.params;
  const originCheck = validateMutationOrigin(request);

  if (!originCheck.ok) {
    return response("Forbidden.", 403);
  }

  const supabase = await createSupabaseServerClient();
  const workspaceResult = await loadWorkspaceContext({ slug }, supabase);

  if (!workspaceResult.ok) {
    if (workspaceResult.reason === "unauthenticated") {
      return redirectTo(
        request,
        `/login?next=${encodeURIComponent(keysPath(slug))}`,
      );
    }

    return response("Workspace not found.", 404);
  }

  if (!isWorkspaceAdmin(workspaceResult.context)) {
    return response("Admin access required.", 403);
  }

  const result = await revokeMcpKey(
    {
      mcpKeyId: keyId,
      workspaceId: workspaceResult.context.workspace.id,
    },
    supabase as never,
  );

  if (!result.ok) {
    if (result.reason === "forbidden") {
      return response("Admin access required.", 403);
    }

    return redirectTo(request, keysPath(slug, "?error=revoke"));
  }

  return redirectTo(request, keysPath(slug, "?revoked=1"));
}
