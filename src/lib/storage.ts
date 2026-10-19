import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Storage is accessed only through this module so the provider can be swapped
// (e.g. to Cloudflare R2) without touching routes or components.

// quarantine: template files (20 MB objects). screenshot-uploads and
// avatar-uploads: original images, with per-object limits that match their
// upload limits. previews: public, server re-encoded images only.
export type Bucket = "quarantine" | "screenshot-uploads" | "avatar-uploads" | "previews";

export interface ObjectStorage {
  createUploadUrl(bucket: Bucket, key: string): Promise<{ signedUrl: string; token: string }>;
  createDownloadUrl(bucket: Bucket, key: string, ttlSeconds: number, downloadName: string): Promise<string>;
  remove(bucket: Bucket, keys: string[]): Promise<void>;
}

class SupabaseObjectStorage implements ObjectStorage {
  async createUploadUrl(bucket: Bucket, key: string) {
    // Never upsert: a key can be written once, so processed objects cannot be replaced.
    const { data, error } = await createAdminClient().storage.from(bucket).createSignedUploadUrl(key, { upsert: false });
    if (error || !data) throw new Error(`Could not create upload URL: ${error?.message ?? "unknown"}`);
    return { signedUrl: data.signedUrl, token: data.token };
  }

  async createDownloadUrl(bucket: Bucket, key: string, ttlSeconds: number, downloadName: string) {
    const { data, error } = await createAdminClient()
      .storage.from(bucket)
      .createSignedUrl(key, ttlSeconds, { download: downloadName });
    if (error || !data) throw new Error(`Could not create download URL: ${error?.message ?? "unknown"}`);
    return data.signedUrl;
  }

  async remove(bucket: Bucket, keys: string[]) {
    if (keys.length === 0) return;
    await createAdminClient().storage.from(bucket).remove(keys);
  }
}

export const storage: ObjectStorage = new SupabaseObjectStorage();
