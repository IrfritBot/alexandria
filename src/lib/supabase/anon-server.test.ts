import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSupabaseAnonServerClient,
  hasSupabaseAnonConfig,
} from "./anon-server";

vi.mock("server-only", () => ({}));

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

describe("Supabase anon server client", () => {
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

  it("throws a stable error when anon environment variables are missing", () => {
    clearSupabaseEnv();

    expect(hasSupabaseAnonConfig()).toBe(false);
    expect(() => createSupabaseAnonServerClient()).toThrow(
      "Supabase environment variables are not configured.",
    );
  });

  it("constructs an anon server client when environment variables are present", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

    expect(hasSupabaseAnonConfig()).toBe(true);
    expect(createSupabaseAnonServerClient().auth).toBeDefined();
  });
});
