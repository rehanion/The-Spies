// Sensitive account changes need a recent sign in. Email confirmation is off,
// so Supabase's emailed reauthentication nonce cannot be used. Instead the
// session's own sign-in time is checked: the `amr` claim lists each method
// used to authenticate this session (password, recovery link, OTP) with its
// Unix timestamp. Token refreshes keep these timestamps, so a stolen or
// long-lived session cannot pass the check.

export const REAUTH_WINDOW_SECONDS = 10 * 60;

/** The latest authentication time (Unix seconds) in the JWT claims, or null. */
export function lastAuthenticatedAt(claims: Record<string, unknown> | null | undefined): number | null {
  const amr = claims?.amr;
  if (!Array.isArray(amr)) return null;
  let latest: number | null = null;
  for (const entry of amr) {
    const ts = (entry as { timestamp?: unknown } | null)?.timestamp;
    if (typeof ts === "number" && Number.isFinite(ts) && (latest === null || ts > latest)) latest = ts;
  }
  return latest;
}

export function signedInRecently(
  claims: Record<string, unknown> | null | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
  windowSeconds = REAUTH_WINDOW_SECONDS,
): boolean {
  const at = lastAuthenticatedAt(claims);
  // A small allowance for clock skew in the future direction only.
  return at !== null && at <= nowSeconds + 60 && nowSeconds - at <= windowSeconds;
}
