import { afterEach, describe, expect, it } from "vitest";

import { getSupabaseAnonEnv, hasSupabaseAnonEnv } from "./env";

const SUPABASE_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

const originalEnv = Object.fromEntries(
  SUPABASE_ENV_KEYS.map((key) => [key, process.env[key]]),
);

function clearSupabaseEnv() {
  for (const key of SUPABASE_ENV_KEYS) {
    delete process.env[key];
  }
}

describe("Supabase anon env", () => {
  afterEach(() => {
    for (const key of SUPABASE_ENV_KEYS) {
      const originalValue = originalEnv[key];

      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }
  });

  it("returns the anon env when configured", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

    expect(hasSupabaseAnonEnv()).toBe(true);
    expect(getSupabaseAnonEnv()).toEqual({
      url: "https://example.supabase.co",
      anonKey: "anon-key",
    });
  });

  it("throws a stable error when the anon env is missing", () => {
    clearSupabaseEnv();

    expect(hasSupabaseAnonEnv()).toBe(false);
    expect(() => getSupabaseAnonEnv()).toThrow(
      "Supabase environment variables are not configured.",
    );
  });
});
