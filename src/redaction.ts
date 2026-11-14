/** Whether repository file text holds an unambiguous credential: a private
 * key block, a GitHub token, an `sk-` API key or a JWT (#275). Repository
 * files are code, so `redact`'s broader forms (any `apiKey = …`, any
 * `user:password@` URL) refuse ordinary code there; logs and reports keep
 * them. */
export function credentialLike(value: string): boolean {
  return (
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(value) ||
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-|svcacct-|ant-)?[A-Za-z0-9_-]{20,})/.test(
      value,
    ) ||
    /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/.test(
      value,
    )
  );
}
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
      /(["']?authorization["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|(?:[A-Za-z][A-Za-z0-9_-]*[ \t]+)?[^\s&;,]+)/gi,
      "$1[REDACTED]",
    )
    .replace(
      /(["']?[\w-]*(?:token|password|secret|api[_-]?key|authorization|private[_-]?key)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s&;,]+)/gi,
      "$1[REDACTED]",
    );
}
