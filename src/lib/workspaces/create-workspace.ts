import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "../supabase/server";

export type CreateWorkspaceInput = {
  name: string;
  slug: string;
  contextDescription: string;
};

export type CreateWorkspaceField = "name" | "slug" | "contextDescription";

export type CreateWorkspaceResult =
  | {
      ok: true;
      workspaceId: string;
    }
  | {
      ok: false;
      reason:
        | "invalid_input"
        | "slug_taken"
        | "unauthenticated"
        | "missing_profile"
        | "workspace_creation_failed";
      field?: CreateWorkspaceField;
    };

type RpcClient = Pick<SupabaseClient, "rpc">;

const MIN_SLUG_LEN = 3;
const MAX_SLUG_LEN = 63;
const MIN_CONTEXT_DESCRIPTION_LEN = 30;
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function validateWorkspaceInput(
  input: CreateWorkspaceInput,
): { ok: true } | { ok: false; field: CreateWorkspaceField } {
  if (input.name.trim().length === 0) {
    return { ok: false, field: "name" };
  }

  const slug = input.slug.trim();

  if (
    slug.length < MIN_SLUG_LEN ||
    slug.length > MAX_SLUG_LEN ||
    slug !== slug.toLowerCase() ||
    !SLUG_PATTERN.test(slug)
  ) {
    return { ok: false, field: "slug" };
  }

  if (input.contextDescription.trim().length < MIN_CONTEXT_DESCRIPTION_LEN) {
    return { ok: false, field: "contextDescription" };
  }

  return { ok: true };
}

function getInvalidInputField(message?: string): CreateWorkspaceField | null {
  if (message?.includes("invalid_input:name")) {
    return "name";
  }

  if (message?.includes("invalid_input:slug")) {
    return "slug";
  }

  if (message?.includes("invalid_input:contextDescription")) {
    return "contextDescription";
  }

  return null;
}

function mapRpcError(error: {
  code?: string;
  message?: string;
}): CreateWorkspaceResult {
  if (error.code === "23505") {
    return { ok: false, reason: "slug_taken" };
  }

  if (
    error.code === "28000" ||
    error.message?.toLowerCase().includes("unauthenticated")
  ) {
    return { ok: false, reason: "unauthenticated" };
  }

  if (error.message?.includes("missing_profile")) {
    return { ok: false, reason: "missing_profile" };
  }

  if (error.code === "22023") {
    const field = getInvalidInputField(error.message);

    if (!field) {
      return { ok: false, reason: "workspace_creation_failed" };
    }

    return {
      ok: false,
      reason: "invalid_input",
      field,
    };
  }

  return { ok: false, reason: "workspace_creation_failed" };
}

export async function createWorkspace(
  input: CreateWorkspaceInput,
  rpcClient?: RpcClient,
): Promise<CreateWorkspaceResult> {
  const validation = validateWorkspaceInput(input);

  if (!validation.ok) {
    return {
      ok: false,
      reason: "invalid_input",
      field: validation.field,
    };
  }

  try {
    const supabase = rpcClient ?? (await createSupabaseServerClient());
    const { data, error } = await supabase.rpc("create_workspace_with_admin", {
      p_context_description: input.contextDescription.trim(),
      p_name: input.name.trim(),
      p_slug: input.slug.trim(),
    });

    if (error) {
      return mapRpcError(error);
    }

    return {
      ok: true,
      workspaceId: String(data),
    };
  } catch {
    return {
      ok: false,
      reason: "workspace_creation_failed",
    };
  }
}
