// SPIES upload processor (Supabase Edge Function, Deno).
//
// Called only by the SPIES server with a shared secret after a creator has
// uploaded an object to the private quarantine bucket via a signed upload URL.
// It reads the exact stored bytes, computes the authoritative SHA-256, runs
// structural validation (allowlist, magic bytes, ZIP inspection) for template
// files, and re-encodes screenshots/avatars into the public previews bucket.
// It never executes uploaded content and never trusts client metadata: the
// object key and platform come from the database row, not the request.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sha256Hex, timingSafeEqual } from "../_shared/hash.ts";
import { processScreenshot } from "../_shared/images.ts";
import { readLimits, type Limits } from "../_shared/limits.ts";
import { validateTemplateFile } from "../_shared/validate-file.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function download(db: SupabaseClient, bucket: string, key: string): Promise<Uint8Array | null> {
  const { data, error } = await db.storage.from(bucket).download(key);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

/** Returns a reason when the stored object is not the size that was reserved. */
function sizeMismatch(actual: number, declared: number, max: number): string | null {
  if (actual > max) return "The file is larger than the upload limit.";
  if (actual !== Number(declared)) return "The stored file does not match the size given when the upload started. Upload it again.";
  return null;
}

async function processFile(db: SupabaseClient, id: string, limits: Limits): Promise<Response> {
  const { data: row, error } = await db
    .from("template_files")
    .select("id, template_id, storage_key, original_filename, declared_size_bytes, validation_status, is_current, templates!inner(platform_id, platforms!inner(upload_formats, zip_formats))")
    .eq("id", id)
    .single();
  if (error || !row) return json({ error: "not_found" }, 404);
  if (row.validation_status !== "pending") return json({ status: row.validation_status });
  if (!row.is_current) return json({ error: "superseded" }, 409);

  const bytes = await download(db, "quarantine", row.storage_key);
  if (!bytes) return json({ status: "awaiting_upload" }, 409);

  const sha256 = await sha256Hex(bytes);
  const platform = (row as unknown as { templates: { platforms: { upload_formats: string[]; zip_formats: string[] } } }).templates.platforms;
  const rules = platform ? { upload: platform.upload_formats, zipInner: platform.zip_formats } : null;
  // The reservation was checked against quotas at its declared size; the
  // stored object must be exactly that big.
  const sizeProblem = sizeMismatch(bytes.length, row.declared_size_bytes, limits.maxTemplateFileBytes);
  const result: ReturnType<typeof validateTemplateFile> = sizeProblem
    ? { ok: false, reason: sizeProblem, report: {} }
    : validateTemplateFile(bytes, row.original_filename, rules, limits);
  const now = new Date().toISOString();

  const { error: updateError } = await db
    .from("template_files")
    .update({
      size_bytes: bytes.length,
      sha256,
      detected_format: result.ok ? result.report.detected : (result.report.detected ?? null),
      validation_status: result.ok ? "passed" : "failed",
      validation_report: result.ok ? result.report : { ...result.report, error: result.reason },
      contains_code: result.ok && !!result.report.containsCode,
      needs_review: result.ok && !!result.report.needsReview,
      uploaded_at: now,
      processed_at: now,
    })
    .eq("id", row.id)
    .eq("validation_status", "pending");
  if (updateError) return json({ error: "update_failed" }, 500);

  await db.rpc("log_event", {
    p_action: result.ok ? "validation:passed" : "validation:failed",
    p_template_id: row.template_id,
    p_file_id: row.id,
    p_details: { sha256, size: bytes.length, reason: result.ok ? null : result.reason },
  });

  if (!result.ok) {
    // Rejected content is not kept: free the quota, keep the record and hash.
    await db.storage.from("quarantine").remove([row.storage_key]);
    return json({ status: "failed", reason: result.reason });
  }
  return json({ status: "passed", sha256, size: bytes.length });
}

async function processScreenshotRow(db: SupabaseClient, id: string, limits: Limits): Promise<Response> {
  const { data: row, error } = await db
    .from("template_screenshots")
    .select("id, template_id, original_bucket, original_key, declared_size_bytes, status")
    .eq("id", id)
    .single();
  if (error || !row) return json({ error: "not_found" }, 404);
  if (row.status !== "pending") return json({ status: row.status });

  const bytes = await download(db, row.original_bucket, row.original_key);
  if (!bytes) return json({ status: "awaiting_upload" }, 409);

  const sizeProblem = sizeMismatch(bytes.length, row.declared_size_bytes, limits.maxScreenshotBytes);
  const result = sizeProblem
    ? ({ ok: false, reason: sizeProblem } as const)
    : await processScreenshot(bytes, {
        maxBytes: limits.maxScreenshotBytes,
        maxPixels: limits.maxScreenshotPixels,
        fullMaxWidth: limits.previewMaxWidth,
        thumbWidth: limits.thumbWidth,
      });

  // The original never becomes public; once processed it is no longer needed.
  await db.storage.from(row.original_bucket).remove([row.original_key]);

  if (!result.ok) {
    await db
      .from("template_screenshots")
      .update({ status: "failed", failure_reason: result.reason, size_bytes: bytes.length })
      .eq("id", row.id);
    return json({ status: "failed", reason: result.reason });
  }

  const publicKey = `shots/${row.template_id}/${crypto.randomUUID()}.${result.image.extension}`;
  const thumbKey = `shots/${row.template_id}/${crypto.randomUUID()}.${result.image.extension}`;
  const opts = { contentType: result.image.contentType, cacheControl: "31536000", upsert: false };
  const up1 = await db.storage.from("previews").upload(publicKey, result.image.full, opts);
  const up2 = await db.storage.from("previews").upload(thumbKey, result.image.thumb, opts);
  if (up1.error || up2.error) {
    await db.storage.from("previews").remove([publicKey, thumbKey]);
    await db
      .from("template_screenshots")
      .update({ status: "failed", failure_reason: "Storage is unavailable or full. Try again later." })
      .eq("id", row.id);
    return json({ status: "failed", reason: "storage_error" }, 503);
  }

  await db
    .from("template_screenshots")
    .update({
      status: "ready",
      public_key: publicKey,
      thumb_key: thumbKey,
      width: result.image.width,
      height: result.image.height,
      size_bytes: bytes.length,
      public_size_bytes: result.image.full.length + result.image.thumb.length,
      failure_reason: null,
    })
    .eq("id", row.id);

  // First ready screenshot becomes the cover if none is chosen.
  await db
    .from("templates")
    .update({ cover_screenshot_id: row.id })
    .eq("id", row.template_id)
    .is("cover_screenshot_id", null);

  return json({ status: "ready", width: result.image.width, height: result.image.height });
}

async function processAvatar(db: SupabaseClient, userId: string, key: string, limits: Limits): Promise<Response> {
  if (!new RegExp(`^avatars/${userId}/[0-9a-f-]{36}\\.bin$`).test(key)) return json({ error: "bad_key" }, 400);
  // Only a key the server reserved for this user, once, within the upload URL's lifetime.
  const { data: reservation } = await db
    .from("avatar_uploads")
    .select("id, declared_size_bytes, status, created_at")
    .eq("storage_key", key)
    .eq("user_id", userId)
    .maybeSingle();
  if (!reservation) return json({ error: "bad_key" }, 400);
  if (reservation.status !== "pending") return json({ status: reservation.status === "ready" ? "ready" : "failed" });
  if (Date.parse(reservation.created_at) < Date.now() - 2 * 3600 * 1000) return json({ status: "failed", reason: "The upload expired. Please try again." });
  const bytes = await download(db, "avatar-uploads", key);
  if (!bytes) return json({ status: "awaiting_upload" }, 409);
  await db.storage.from("avatar-uploads").remove([key]);
  const sizeProblem = sizeMismatch(bytes.length, reservation.declared_size_bytes, limits.maxAvatarBytes);
  const result = sizeProblem
    ? ({ ok: false, reason: sizeProblem } as const)
    : await processScreenshot(bytes, {
        maxBytes: limits.maxAvatarBytes,
        maxPixels: limits.maxScreenshotPixels,
        fullMaxWidth: 256,
        thumbWidth: 96,
      });
  const finish = (status: "ready" | "failed") =>
    db.from("avatar_uploads").update({ status, processed_at: new Date().toISOString() }).eq("id", reservation.id).eq("status", "pending");
  if (!result.ok) {
    await finish("failed");
    return json({ status: "failed", reason: result.reason });
  }
  const avatarKey = `avatars/${crypto.randomUUID()}.jpg`;
  const up = await db.storage.from("previews").upload(avatarKey, result.image.full, {
    contentType: "image/jpeg",
    cacheControl: "31536000",
  });
  if (up.error) {
    await finish("failed");
    return json({ status: "failed", reason: "storage_error" }, 503);
  }
  await finish("ready");
  const { data: prev } = await db.from("profiles").select("avatar_key").eq("id", userId).single();
  await db.from("profiles").update({ avatar_key: avatarKey }).eq("id", userId);
  if (prev?.avatar_key) await db.storage.from("previews").remove([prev.avatar_key]);
  return json({ status: "ready", avatar_key: avatarKey });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const secret = Deno.env.get("PROCESSOR_SECRET") ?? "";
  const provided = req.headers.get("x-processor-secret") ?? "";
  if (secret.length < 32 || !timingSafeEqual(secret, provided)) return json({ error: "unauthorized" }, 401);

  let body: { kind?: string; id?: string; userId?: string; key?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SPIES_SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "misconfigured" }, 500);
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const limits = readLimits(Deno.env.toObject());

  try {
    if (body.kind === "file" && body.id && UUID.test(body.id)) return await processFile(db, body.id, limits);
    if (body.kind === "screenshot" && body.id && UUID.test(body.id)) return await processScreenshotRow(db, body.id, limits);
    if (body.kind === "avatar" && body.userId && UUID.test(body.userId) && body.key) {
      return await processAvatar(db, body.userId, body.key, limits);
    }
    return json({ error: "bad_request" }, 400);
  } catch (err) {
    console.error("process-upload failed", err);
    return json({ error: "processing_error" }, 500);
  }
});
