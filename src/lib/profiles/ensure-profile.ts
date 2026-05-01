import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "../supabase/server";

export type Profile = {
  id: string;
  auth_user_id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type EnsureProfileInput = {
  email: string;
  displayName?: string | null;
};

export type EnsureProfileResult =
  | {
      ok: true;
      profile: Profile;
    }
  | {
      ok: false;
      reason: "unauthenticated" | "invalid_email" | "profile_sync_failed";
    };

type RpcClient = Pick<SupabaseClient, "rpc">;

function getFailureReason(error: { code?: string; message?: string }) {
  if (
    error.code === "28000" ||
    error.message?.toLowerCase().includes("authenticated")
  ) {
    return "unauthenticated";
  }

  if (
    error.code === "22023" ||
    error.message?.toLowerCase().includes("invalid email")
  ) {
    return "invalid_email";
  }

  return "profile_sync_failed";
}

export async function ensureProfile(
  input: EnsureProfileInput,
  rpcClient?: RpcClient,
): Promise<EnsureProfileResult> {
  try {
    const supabase = rpcClient ?? (await createSupabaseServerClient());
    const { data, error } = await supabase.rpc("ensure_profile", {
      p_display_name: input.displayName ?? null,
      p_email: input.email,
    });

    if (error) {
      return {
        ok: false,
        reason: getFailureReason(error),
      };
    }

    return {
      ok: true,
      profile: data as Profile,
    };
  } catch {
    return {
      ok: false,
      reason: "profile_sync_failed",
    };
  }
}
