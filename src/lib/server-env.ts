import "server-only";
import { readLimits, type Limits } from "@shared/limits.ts";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required server environment variable ${name}`);
  return value;
}

export const serverEnv = {
  supabaseSecretKey: () => required("SUPABASE_SECRET_KEY"),
  processorSecret: () => required("PROCESSOR_SECRET"),
  functionsUrl: () =>
    (process.env.SUPABASE_FUNCTIONS_URL ?? `${required("NEXT_PUBLIC_SUPABASE_URL")}/functions/v1`).replace(/\/$/, ""),
  turnstileSecret: () => process.env.TURNSTILE_SECRET_KEY ?? "",
  /** Explicit opt-out for local development only. */
  turnstileDisabled: () => process.env.TURNSTILE_DISABLED === "true",
  downloadRequiresLogin: () => process.env.DOWNLOAD_REQUIRE_LOGIN !== "false",
  downloadUrlTtlSeconds: () => {
    const n = Number(process.env.DOWNLOAD_URL_TTL_SECONDS ?? "60");
    return Number.isInteger(n) && n >= 10 && n <= 300 ? n : 60;
  },
  actorHashSalt: () => required("ACTOR_HASH_SALT"),
  uploadsPaused: () => process.env.UPLOADS_PAUSED === "true",
};

let cachedLimits: Limits | null = null;
export function limits(): Limits {
  cachedLimits ??= readLimits(process.env);
  return cachedLimits;
}
