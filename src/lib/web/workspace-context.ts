import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";

import { createSupabaseServerClient } from "../supabase/server";

export type WorkspaceRole = "member" | "admin";

export type WebWorkspace = {
  contextDescription: string;
  createdAt: string;
  id: string;
  name: string;
  slug: string;
  tier: string;
};

export type WebProfile = {
  displayName: string | null;
  id: string;
};

export type WebWorkspaceContext = {
  membership: {
    joinedAt: string;
    role: WorkspaceRole;
  };
  profile: WebProfile;
  user: {
    email: string | null;
    id: string;
  };
  workspace: WebWorkspace;
};

export type LoadWorkspaceContextResult =
  | {
      context: WebWorkspaceContext;
      ok: true;
    }
  | {
      ok: false;
      reason:
        | "load_failed"
        | "missing_profile"
        | "not_found"
        | "not_member"
        | "unauthenticated";
    };

type WebSupabaseClient = Pick<SupabaseClient, "from"> & {
  auth: Pick<SupabaseClient["auth"], "getUser">;
};

function isRole(value: unknown): value is WorkspaceRole {
  return value === "member" || value === "admin";
}

function mapWorkspace(row: Record<string, unknown> | null): WebWorkspace | null {
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.name !== "string" ||
    typeof row.slug !== "string" ||
    typeof row.context_description !== "string" ||
    typeof row.tier !== "string" ||
    typeof row.created_at !== "string"
  ) {
    return null;
  }

  return {
    contextDescription: row.context_description,
    createdAt: row.created_at,
    id: row.id,
    name: row.name,
    slug: row.slug,
    tier: row.tier,
  };
}

function mapProfile(row: Record<string, unknown> | null): WebProfile | null {
  if (!row || typeof row.id !== "string") {
    return null;
  }

  return {
    displayName:
      typeof row.display_name === "string" ? row.display_name : null,
    id: row.id,
  };
}

function mapMembership(
  row: Record<string, unknown> | null,
): WebWorkspaceContext["membership"] | null {
  if (!row || !isRole(row.role) || typeof row.joined_at !== "string") {
    return null;
  }

  return {
    joinedAt: row.joined_at,
    role: row.role,
  };
}

function loginPath(nextPath: string) {
  return `/login?next=${encodeURIComponent(nextPath)}`;
}

export function isWorkspaceAdmin(context: Pick<WebWorkspaceContext, "membership">) {
  return context.membership.role === "admin";
}

export async function loadWorkspaceContext(
  input: { slug: string },
  supabase: WebSupabaseClient,
): Promise<LoadWorkspaceContextResult> {
  const slug = input.slug.trim();

  if (!slug) {
    return { ok: false, reason: "not_found" };
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { ok: false, reason: "unauthenticated" };
  }

  const { data: workspaceRow, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id, name, slug, context_description, tier, created_at")
    .eq("slug", slug)
    .maybeSingle();

  if (workspaceError) {
    return { ok: false, reason: "load_failed" };
  }

  const workspace = mapWorkspace(workspaceRow as Record<string, unknown> | null);

  if (!workspace) {
    return { ok: false, reason: "not_found" };
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name")
    .eq("auth_user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (profileError) {
    return { ok: false, reason: "load_failed" };
  }

  const profile = mapProfile(profileRow as Record<string, unknown> | null);

  if (!profile) {
    return { ok: false, reason: "missing_profile" };
  }

  const { data: membershipRow, error: membershipError } = await supabase
    .from("workspace_members")
    .select("role, joined_at")
    .eq("workspace_id", workspace.id)
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (membershipError) {
    return { ok: false, reason: "load_failed" };
  }

  const membership = mapMembership(
    membershipRow as Record<string, unknown> | null,
  );

  if (!membership) {
    return { ok: false, reason: "not_member" };
  }

  return {
    context: {
      membership,
      profile,
      user: {
        email: user.email ?? null,
        id: user.id,
      },
      workspace,
    },
    ok: true,
  };
}

export async function requireWorkspaceContext(input: {
  nextPath?: string;
  slug: string;
}): Promise<WebWorkspaceContext & { supabase: SupabaseClient }> {
  const supabase = await createSupabaseServerClient();
  const result = await loadWorkspaceContext(input, supabase);

  if (result.ok) {
    return {
      ...result.context,
      supabase,
    };
  }

  if (result.reason === "unauthenticated") {
    redirect(loginPath(input.nextPath ?? `/workspaces/${input.slug}`));
  }

  if (result.reason === "load_failed") {
    throw new Error("Unable to load workspace context.");
  }

  notFound();
}
