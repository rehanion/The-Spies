import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export const RATE_LIMITS = {
  createSubmission: { limit: 10, windowSeconds: 3600 },
  uploadInit: { limit: 60, windowSeconds: 3600 },
  download: { limit: 60, windowSeconds: 600 },
  report: { limit: 5, windowSeconds: 3600 },
  review: { limit: 20, windowSeconds: 3600 },
  favorite: { limit: 120, windowSeconds: 3600 },
} as const;

export type RateLimitName = keyof typeof RATE_LIMITS;

/** Database-backed fixed-window limiter (Workers have no shared memory). Fails closed. */
export async function consumeRateLimit(name: RateLimitName, subject: string): Promise<boolean> {
  const { limit, windowSeconds } = RATE_LIMITS[name];
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("consume_rate_limit", {
    p_key: `${name}:${subject}`,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) return false;
  return data === true;
}
