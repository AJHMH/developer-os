/** Defense in depth for common credential forms; not a detector for arbitrary secrets. */
export function redact(value: string): string {
  return value
    .replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
      "[REDACTED]",
    )
    .replace(/([a-z][a-z\d+.-]*:\/\/)[^/\s@]+@/gi, "$1[REDACTED]@")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(?:gh[pousr]_|github_pat_|sk-(?:proj-|svcacct-)?)[A-Za-z0-9_-]+\b/g,
      "[REDACTED]",
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[REDACTED]",
    )
    .replace(
      /(["']?[\w-]*(?:token|password|secret|api[_-]?key|authorization|private[_-]?key)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s&;,]+)/gi,
      "$1[REDACTED]",
    );
}
