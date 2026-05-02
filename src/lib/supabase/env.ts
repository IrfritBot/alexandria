export type SupabaseAnonEnv = {
  url: string;
  anonKey: string;
};

export const SUPABASE_ENV_ERROR =
  "Supabase environment variables are not configured.";

export function hasSupabaseAnonEnv() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export function getSupabaseAnonEnv(): SupabaseAnonEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(SUPABASE_ENV_ERROR);
  }

  return { url, anonKey };
}
