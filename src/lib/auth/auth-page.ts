import { buildAuthCallbackUrl } from "./auth-callback-url";
import { getSafeNext } from "./safe-next";

export type AuthMode = "login" | "signup";

type AuthPageSupabase = {
  auth: {
    getUser(): Promise<{
      data: {
        user: unknown | null;
      };
    }>;
  };
};

type HeadersLike = {
  get(name: string): string | null;
};

export type AuthPageState =
  | {
      callbackUrl: string;
      kind: "render";
    }
  | {
      kind: "redirect";
      location: string;
    };

function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}

export function firstSearchParamValue(
  value: string | string[] | undefined,
): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

export function getAuthRequestOrigin(
  headers: HeadersLike,
  fallbackOrigin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
) {
  const host =
    firstHeaderValue(headers.get("x-forwarded-host")) ??
    firstHeaderValue(headers.get("host"));

  if (!host) {
    return fallbackOrigin;
  }

  const protocol =
    firstHeaderValue(headers.get("x-forwarded-proto")) ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");

  return `${protocol}://${host}`;
}

export async function getAuthPageState({
  origin,
  rawNext,
  supabase,
}: {
  origin: string;
  rawNext: string | null;
  supabase: AuthPageSupabase;
}): Promise<AuthPageState> {
  const safeNext = getSafeNext(rawNext);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    return {
      kind: "redirect",
      location: safeNext,
    };
  }

  return {
    callbackUrl: buildAuthCallbackUrl(origin, rawNext),
    kind: "render",
  };
}
