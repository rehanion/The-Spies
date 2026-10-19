/**
 * Returns a same-origin relative path for post-login redirects, or the
 * fallback. Rejects absolute URLs, protocol-relative URLs and backslash tricks.
 */
export function safeNextPath(input: unknown, fallback = "/"): string {
  if (typeof input !== "string" || input.length === 0 || input.length > 512) return fallback;
  if (!input.startsWith("/") || input.startsWith("//") || input.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\\]/.test(input)) return fallback;
  try {
    const url = new URL(input, "http://spies.invalid");
    if (url.origin !== "http://spies.invalid") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
