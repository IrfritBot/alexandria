import { NextResponse } from "next/server";

import {
  createWorkspace,
  type CreateWorkspaceField,
} from "../../../lib/workspaces/create-workspace";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { validateMutationOrigin } from "../../../lib/web/post-origin";

type WorkspaceBody = {
  name: string;
  slug: string;
  contextDescription: string;
};

function jsonResponse(body: unknown, status: number) {
  return NextResponse.json(body, { status });
}

function invalidInput(field: CreateWorkspaceField) {
  return jsonResponse({ error: "invalid_input", field }, 400);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parseWorkspaceBody(
  request: Request,
): Promise<
  | {
      ok: true;
      body: WorkspaceBody;
    }
  | {
      ok: false;
      field: CreateWorkspaceField;
    }
> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return { ok: false, field: "name" };
  }

  if (!isRecord(body)) {
    return { ok: false, field: "name" };
  }

  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return { ok: false, field: "name" };
  }

  if (typeof body.slug !== "string" || body.slug.trim().length === 0) {
    return { ok: false, field: "slug" };
  }

  if (
    typeof body.contextDescription !== "string" ||
    body.contextDescription.trim().length === 0
  ) {
    return { ok: false, field: "contextDescription" };
  }

  return {
    ok: true,
    body: {
      contextDescription: body.contextDescription,
      name: body.name,
      slug: body.slug,
    },
  };
}

export async function POST(request: Request) {
  const originCheck = validateMutationOrigin(request);

  if (!originCheck.ok) {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return jsonResponse({ error: "unauthenticated" }, 401);
  }

  const parsedBody = await parseWorkspaceBody(request);

  if (!parsedBody.ok) {
    return invalidInput(parsedBody.field);
  }

  const result = await createWorkspace(parsedBody.body, supabase);

  if (result.ok) {
    return jsonResponse({ workspaceId: result.workspaceId }, 200);
  }

  if (result.reason === "slug_taken") {
    return jsonResponse({ error: "slug_taken" }, 409);
  }

  if (result.reason === "invalid_input") {
    return invalidInput(result.field ?? "name");
  }

  if (result.reason === "unauthenticated" || result.reason === "missing_profile") {
    return jsonResponse({ error: "unauthenticated" }, 401);
  }

  return jsonResponse({ error: "workspace_creation_failed" }, 500);
}
