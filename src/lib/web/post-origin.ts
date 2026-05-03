export type MutationOriginCheck =
  | {
      ok: true;
    }
  | {
      ok: false;
      reason: "cross_origin" | "missing_origin";
    };

function parsedOrigin(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function validateMutationOrigin(request: Request): MutationOriginCheck {
  const requestOrigin = new URL(request.url).origin;
  const origin = parsedOrigin(request.headers.get("origin"));

  if (origin) {
    return origin === requestOrigin
      ? { ok: true }
      : { ok: false, reason: "cross_origin" };
  }

  const referer = parsedOrigin(request.headers.get("referer"));

  if (referer) {
    return referer === requestOrigin
      ? { ok: true }
      : { ok: false, reason: "cross_origin" };
  }

  return { ok: false, reason: "missing_origin" };
}
