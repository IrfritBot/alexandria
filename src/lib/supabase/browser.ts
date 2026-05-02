import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAnonEnv, hasSupabaseAnonEnv } from "./env";

export function hasSupabaseBrowserConfig() {
  return hasSupabaseAnonEnv();
}

export function createSupabaseBrowserClient(): SupabaseClient {
  const { url, anonKey } = getSupabaseAnonEnv();

  return createBrowserClient(url, anonKey);
}
