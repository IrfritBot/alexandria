import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAnonEnv, hasSupabaseAnonEnv } from "./env";

const MCP_EXECUTOR_ENV_ERROR =
  "Supabase MCP executor environment variables are not configured.";

export function hasSupabaseMcpExecutorConfig() {
  return Boolean(hasSupabaseAnonEnv() && process.env.SUPABASE_MCP_EXECUTOR_JWT);
}

export function createSupabaseMcpExecutorClient(): SupabaseClient {
  const { url, anonKey } = getSupabaseAnonEnv();
  const executorJwt = process.env.SUPABASE_MCP_EXECUTOR_JWT;

  if (!executorJwt) {
    throw new Error(MCP_EXECUTOR_ENV_ERROR);
  }

  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${executorJwt}`,
      },
    },
  });
}
