export function getSafeNext(rawNext: string | null): string {
  if (!rawNext) {
    return "/";
  }

  let next: string;

  try {
    next = decodeURIComponent(rawNext);
  } catch {
    return "/";
  }

  if (
    !next.startsWith("/") ||
    next.includes("//") ||
    next.includes("\\") ||
    // ":" rejection is intentional per the ALEX-002 plan, including in query strings.
    next.includes(":") ||
    /\s/.test(next) ||
    /^\/(?:api|auth)(?:\/|$)/i.test(next)
  ) {
    return "/";
  }

  return next;
}
