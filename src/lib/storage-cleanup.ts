import "server-only";
import { storage, type Bucket } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKETS: readonly Bucket[] = ["quarantine", "screenshot-uploads", "avatar-uploads", "previews"];

/**
 * Deletes upload reservations that never completed (older than 24 hours) and
 * every stored object no live record needs: re-uploads to keys that were
 * already processed, objects of deleted reservations or listings, and failed
 * processor writes. The scheduled scan workflow runs the same two database
 * functions (scripts/ci-setup.mjs cleanup).
 */
export async function cleanupStorage(): Promise<{ files: number; screenshots: number; avatars: number; orphans: number }> {
  const admin = createAdminClient();
  const { data: stale, error } = await admin.rpc("cleanup_stale_uploads");
  if (error) throw new Error("cleanup_stale_uploads failed");
  const { data: orphans, error: orphanError } = await admin.rpc("storage_orphans", {});
  if (orphanError) throw new Error("storage_orphans failed");
  let removed = 0;
  for (const bucket of BUCKETS) {
    const keys = (orphans ?? []).filter((o) => o.bucket_id === bucket).map((o) => o.name);
    for (let i = 0; i < keys.length; i += 100) {
      await storage.remove(bucket, keys.slice(i, i + 100));
    }
    removed += keys.length;
  }
  const counts = stale?.[0] ?? { files: 0, screenshots: 0, avatars: 0 };
  return { ...counts, orphans: removed };
}
