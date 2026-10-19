import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/server-env";

/**
 * Privileged client using the Supabase secret key. Bypasses RLS, so it is only
 * used after the caller's identity and permissions were checked on the server.
 * Never import this from a Client Component.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(publicEnv.supabaseUrl(), serverEnv.supabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
