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
    next.includes(":") ||
    /\s/.test(next) ||
    /^\/(?:api|auth)(?:\/|$)/i.test(next)
  ) {
    return "/";
  }

  return next;
}
