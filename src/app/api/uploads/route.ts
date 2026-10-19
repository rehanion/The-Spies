import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getViewer } from "@/lib/auth";
import { consumeRateLimit } from "@/lib/rate-limit";
import { limits } from "@/lib/server-env";
import { storage } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { UploadError, checkQuotas, precheckUpload } from "@/lib/uploads";
import { getCatalog } from "@/lib/data/catalog";

const bodySchema = z.object({
  templateId: z.uuid(),
  kind: z.enum(["file", "screenshot"]),
  filename: z.string().min(1).max(255),
  size: z.number().int().positive(),
  replacesFileId: z.uuid().nullish(),
});

function error(e: UploadError) {
  return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
}

// Reserves an upload: validates the claim, checks quotas, creates the pending
// database record with a server-generated random storage key and returns a
// short-lived signed upload URL for exactly that key in the private bucket.
export async function POST(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer?.profile) return error(new UploadError("Sign in to upload.", 401, "unauthenticated"));
  if (viewer.profile.is_banned) return error(new UploadError("Your account is suspended.", 403, "suspended"));

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error(new UploadError("Invalid upload request.", 400, "bad_request"));
  const body = parsed.data;

  if (!(await consumeRateLimit("uploadInit", viewer.userId))) {
    return error(new UploadError("Too many uploads in a short time. Wait a little and try again.", 429, "rate_limited"));
  }

  // Ownership check through RLS as the user.
  const supabase = await createClient();
  const { data: template } = await supabase
    .from("templates")
    .select("id, creator_id, platform_id, publication_status")
    .eq("id", body.templateId)
    .maybeSingle();
  if (!template || template.creator_id !== viewer.userId) {
    return error(new UploadError("Submission not found.", 404, "not_found"));
  }
  if (template.publication_status === "removed") {
    return error(new UploadError("Removed listings cannot receive new files.", 409, "removed"));
  }

  try {
    const { filename, extension } = precheckUpload(body, (await getCatalog()).rules(template.platform_id));
    await checkQuotas(viewer.userId, body.size);
    const admin = createAdminClient();
    const l = limits();

    if (body.kind === "file") {
      const { data: current } = await admin
        .from("template_files")
        .select("id, original_filename, storage_key")
        .eq("template_id", template.id)
        .eq("is_current", true);
      const replaced = body.replacesFileId ? current?.find((f) => f.id === body.replacesFileId) : undefined;
      if (body.replacesFileId && !replaced) throw new UploadError("The file to replace was not found.", 404, "not_found");
      const others = (current ?? []).filter((f) => f.id !== replaced?.id);
      if (others.length >= l.maxFilesPerTemplate) {
        throw new UploadError(`A template can have at most ${l.maxFilesPerTemplate} files.`, 409, "too_many_files");
      }
      if (others.some((f) => f.original_filename.toLowerCase() === filename.toLowerCase())) {
        throw new UploadError("A file with this name already exists in this submission. Replace it instead.", 409, "duplicate_name");
      }
      if (replaced) {
        // Supersede the old version first: it can never be downloaded again.
        await admin
          .from("template_files")
          .update({ is_current: false, superseded_at: new Date().toISOString() })
          .eq("id", replaced.id);
        await storage.remove("quarantine", [replaced.storage_key]);
      }
      const id = crypto.randomUUID();
      const key = `files/${template.id}/${crypto.randomUUID()}.bin`;
      const { error: insertError } = await admin.from("template_files").insert({
        id,
        template_id: template.id,
        uploader_id: viewer.userId,
        storage_key: key,
        original_filename: filename,
        extension,
        declared_size_bytes: body.size,
        replaces_file_id: replaced?.id ?? null,
      });
      if (insertError) throw new UploadError("The upload could not be reserved.", 500, "db_error");
      const signed = await storage.createUploadUrl("quarantine", key);
      return NextResponse.json({ id, kind: "file", uploadUrl: signed.signedUrl });
    }

    const { data: shots } = await admin
      .from("template_screenshots")
      .select("id, position")
      .eq("template_id", template.id);
    if ((shots?.length ?? 0) >= l.maxScreenshotsPerTemplate) {
      throw new UploadError(`A template can have at most ${l.maxScreenshotsPerTemplate} screenshots.`, 409, "too_many_screenshots");
    }
    const id = crypto.randomUUID();
    const key = `screenshots/${template.id}/${crypto.randomUUID()}.bin`;
    const position = Math.min(100, (shots ?? []).reduce((m, s) => Math.max(m, s.position + 1), 0));
    const { error: insertError } = await admin.from("template_screenshots").insert({
      id,
      template_id: template.id,
      uploader_id: viewer.userId,
      original_bucket: "screenshot-uploads",
      original_key: key,
      declared_size_bytes: body.size,
      position,
    });
    if (insertError) throw new UploadError("The upload could not be reserved.", 500, "db_error");
    const signed = await storage.createUploadUrl("screenshot-uploads", key);
    return NextResponse.json({ id, kind: "screenshot", uploadUrl: signed.signedUrl });
  } catch (e) {
    if (e instanceof UploadError) return error(e);
    return error(new UploadError("Storage is temporarily unavailable. Please try again later.", 503, "storage_unavailable"));
  }
}
