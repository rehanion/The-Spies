import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { limits, serverEnv } from "@/lib/server-env";
import { SCREENSHOT_EXTENSIONS, checkUploadExtension, extensionOf, type PlatformFormats } from "@shared/formats.ts";
import { sanitizeFilename } from "@shared/filename.ts";

export type UploadKind = "file" | "screenshot";

export class UploadError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}

export interface UploadRequest {
  kind: UploadKind;
  filename: string;
  size: number;
  replacesFileId?: string | null;
}

/** Pure checks on the client's claim before any storage is reserved. */
export function precheckUpload(req: UploadRequest, rules: PlatformFormats | null) {
  const l = limits();
  const filename = sanitizeFilename(req.filename);
  if (!filename) throw new UploadError("The file name is not valid.", 400, "bad_filename");
  if (!Number.isSafeInteger(req.size) || req.size <= 0) throw new UploadError("The file is empty.", 400, "empty");
  if (req.kind === "file") {
    const ext = checkUploadExtension(rules, filename);
    if (!ext.ok) throw new UploadError(ext.reason, 415, "disallowed_type");
    if (req.size > l.maxTemplateFileBytes) {
      throw new UploadError(`Template files can be at most ${Math.round(l.maxTemplateFileBytes / 1048576)} MB.`, 413, "too_large");
    }
    return { filename, extension: ext.format.ext };
  }
  const ext = extensionOf(filename);
  if (!SCREENSHOT_EXTENSIONS.includes(ext)) {
    throw new UploadError("Screenshots must be PNG, JPEG or WebP images. SVG and GIF are not accepted.", 415, "disallowed_type");
  }
  if (req.size > l.maxScreenshotBytes) {
    throw new UploadError(`Screenshots can be at most ${Math.round(l.maxScreenshotBytes / 1048576)} MB.`, 413, "too_large");
  }
  return { filename, extension: ext };
}

/**
 * Quota checks against what is actually stored: the database sums the real
 * object sizes in Storage plus reservations not uploaded yet. Fails closed.
 */
export async function checkQuotas(userId: string, size: number) {
  const l = limits();
  if (serverEnv.uploadsPaused()) {
    throw new UploadError("Uploads are paused by the administrators. Please try again later.", 503, "uploads_paused");
  }
  const admin = createAdminClient();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [usage, userUsage, files24, shots24, avatars24] = await Promise.all([
    admin.rpc("storage_usage"),
    admin.rpc("user_storage_usage", { p_user_id: userId }),
    admin.from("template_files").select("id", { count: "exact", head: true }).eq("uploader_id", userId).gte("created_at", since),
    admin.from("template_screenshots").select("id", { count: "exact", head: true }).eq("uploader_id", userId).gte("created_at", since),
    admin.from("avatar_uploads").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", since),
  ]);
  if (usage.error || userUsage.error || files24.error || shots24.error || avatars24.error) {
    throw new UploadError("Storage usage could not be checked, so the upload was not started. Try again later.", 503, "quota_unavailable");
  }
  const total = usage.data?.[0]?.total_bytes ?? 0;
  if (total + size > l.platformStorageSoftLimitBytes) {
    throw new UploadError(
      "SPIES has reached its free storage allowance, so new uploads are paused. Existing templates remain available. Please try again later.",
      507,
      "platform_storage_full",
    );
  }
  if ((userUsage.data ?? 0) + size > l.perUserStorageBytes) {
    throw new UploadError(
      `This upload would exceed your personal storage allowance of ${Math.round(l.perUserStorageBytes / 1048576)} MB. Delete old drafts or files first.`,
      507,
      "user_storage_full",
    );
  }
  if ((files24.count ?? 0) + (shots24.count ?? 0) + (avatars24.count ?? 0) >= l.perUserDailyUploads) {
    throw new UploadError(`You can upload up to ${l.perUserDailyUploads} files per day.`, 429, "daily_limit");
  }
}
