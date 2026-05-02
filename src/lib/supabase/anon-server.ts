import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAnonEnv, hasSupabaseAnonEnv } from "./env";

export function hasSupabaseAnonConfig() {
  return hasSupabaseAnonEnv();
}

export function createSupabaseAnonServerClient(): SupabaseClient {
  const { url, anonKey } = getSupabaseAnonEnv();

  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
