import "server-only";
import { serverEnv } from "@/lib/server-env";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileResult = { ok: true } | { ok: false; message: string };

/**
 * Verifies a Cloudflare Turnstile token server-side. Fails closed: if no
 * secret is configured, verification only passes when TURNSTILE_DISABLED=true
 * (local development).
 */
export async function verifyTurnstile(token: unknown, ip?: string): Promise<TurnstileResult> {
  const secret = serverEnv.turnstileSecret();
  if (!secret) {
    return serverEnv.turnstileDisabled()
      ? { ok: true }
      : { ok: false, message: "Bot protection is not configured on this server." };
  }
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
    return { ok: false, message: "Please complete the bot check." };
  }
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== "unknown") body.set("remoteip", ip);
    const res = await fetch(SITEVERIFY, { method: "POST", body });
    const data = (await res.json()) as { success?: boolean };
    return data.success ? { ok: true } : { ok: false, message: "The bot check failed or expired. Please try again." };
  } catch {
    return { ok: false, message: "The bot check could not be verified. Please try again." };
  }
}
