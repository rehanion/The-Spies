import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getViewer } from "@/lib/auth";
import { consumeRateLimit } from "@/lib/rate-limit";
import { actorHash, ipHash } from "@/lib/request";
import { serverEnv } from "@/lib/server-env";
import { storage } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sanitizeFilename } from "@shared/filename.ts";

function deny(request: NextRequest, status: number, reason: string, message: string) {
  if (request.headers.get("accept")?.includes("application/json")) {
    return NextResponse.json({ error: reason, message }, { status });
  }
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Download unavailable</title><body style="font-family:system-ui;background:#0b0d10;color:#e6e8eb;padding:2rem"><h1 style="font-size:1.2rem">Download unavailable</h1><p>${message}</p><p><a style="color:#5cbf83" href="/browse">Back to SPIES</a></p></body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

const MESSAGES: Record<string, string> = {
  not_found: "This file does not exist.",
  template_not_approved: "This listing is not published.",
  creator_unavailable: "This creator's account is suspended.",
  file_superseded: "This file version was replaced.",
  validation_not_passed: "This file has not passed validation.",
  scan_pending: "This file is waiting for a malware scan.",
  scan_flagged: "The malware scanner flagged this file.",
  scan_error: "The malware scan failed or did not match the stored file.",
  scan_unavailable: "No accepted scan result exists for this file.",
  hash_mismatch: "The scanned file does not match the stored file.",
  not_approved_version: "This exact file version has not been approved.",
};

// Controlled download. Every request re-checks, in the database, that the
// listing is approved and that this exact file version is current, validated,
// scanned clean with a matching hash, and approved. Only then is a short-lived
// signed URL issued for the private object.
export async function GET(request: NextRequest, ctx: RouteContext<"/api/download/[fileId]">) {
  const { fileId } = await ctx.params;
  if (!z.uuid().safeParse(fileId).success) return deny(request, 400, "bad_request", "Invalid file.");

  const viewer = await getViewer();
  if (serverEnv.downloadRequiresLogin() && !viewer) {
    // Read as the anonymous visitor (RLS), so only a publicly visible listing's
    // slug can end up in the redirect. Private listings send no `next` at all.
    const supabase = await createClient();
    const { data } = await supabase.from("template_files").select("templates!inner(slug)").eq("id", fileId).maybeSingle();
    const slug = (data?.templates as unknown as { slug: string } | undefined)?.slug;
    const login = new URL("/login", request.nextUrl.origin);
    if (slug) login.searchParams.set("next", `/t/${slug}`);
    return NextResponse.redirect(login, 303);
  }
  if (viewer?.profile?.is_banned) return deny(request, 403, "suspended", "Your account is suspended.");

  const subject = viewer?.userId ?? (await ipHash());
  if (!(await consumeRateLimit("download", subject))) {
    return deny(request, 429, "rate_limited", "Too many downloads in a short time. Please wait a few minutes.");
  }

  const admin = createAdminClient();
  const { data: state, error } = await admin.rpc("file_download_state", { p_file_id: fileId });
  if (error) return deny(request, 503, "unavailable", "Downloads are temporarily unavailable.");
  if (state !== "ok") return deny(request, state === "not_found" ? 404 : 403, state ?? "denied", MESSAGES[state ?? ""] ?? "Not available.");

  const { data: file } = await admin
    .from("template_files")
    .select("storage_key, original_filename")
    .eq("id", fileId)
    .single();
  if (!file) return deny(request, 404, "not_found", MESSAGES.not_found);

  // Count at most once per user (or anonymous IP) per file per 24 hours.
  const { error: countError } = await admin.rpc("register_download", {
    p_file_id: fileId,
    p_actor_hash: await actorHash(viewer?.userId ?? null),
    p_user_id: viewer?.userId ?? (null as unknown as string),
  });
  if (countError) return deny(request, 403, "denied", "This file is not available.");

  try {
    const url = await storage.createDownloadUrl(
      "quarantine",
      file.storage_key,
      serverEnv.downloadUrlTtlSeconds(),
      sanitizeFilename(file.original_filename) ?? "template.bin",
    );
    return NextResponse.redirect(url, { status: 303, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  } catch {
    return deny(request, 503, "storage_unavailable", "Storage is temporarily unavailable. Please try again later.");
  }
}
