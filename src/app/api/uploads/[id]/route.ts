import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getViewer } from "@/lib/auth";
import { storage } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Deletes one of the caller's own files or screenshots. Removing content from
// an approved listing sends it back to moderation.
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/uploads/[id]">) {
  const { id } = await ctx.params;
  const kind = request.nextUrl.searchParams.get("kind");
  if (!z.uuid().safeParse(id).success || (kind !== "file" && kind !== "screenshot")) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const viewer = await getViewer();
  if (!viewer?.profile) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (viewer.profile.is_banned) return NextResponse.json({ error: "suspended", message: "Your account is suspended." }, { status: 403 });

  const supabase = await createClient();
  const admin = createAdminClient();
  if (kind === "file") {
    const { data: f } = await supabase
      .from("template_files")
      .select("id, uploader_id, template_id, storage_key, is_current, templates!inner(publication_status)")
      .eq("id", id)
      .maybeSingle();
    if (!f || f.uploader_id !== viewer.userId || !f.is_current) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if ((f.templates as unknown as { publication_status: string }).publication_status === "removed") {
      return NextResponse.json({ error: "removed", message: "Removed listings cannot be changed." }, { status: 409 });
    }
    await admin.from("template_files").update({ is_current: false, superseded_at: new Date().toISOString() }).eq("id", f.id);
    await admin
      .from("templates")
      .update({ publication_status: "pending", approved_at: null, approved_by: null, moderation_note: "A file was removed; re-review required." })
      .eq("id", f.template_id)
      .eq("publication_status", "approved");
    await admin.rpc("log_event", { p_action: "file:removed_by_creator", p_template_id: f.template_id, p_file_id: f.id, p_details: {} });
    await storage.remove("quarantine", [f.storage_key]);
    return NextResponse.json({ ok: true });
  }

  const { data: s } = await supabase
    .from("template_screenshots")
    .select("id, uploader_id, template_id, original_bucket, original_key, public_key, thumb_key, templates!inner(publication_status, cover_screenshot_id)")
    .eq("id", id)
    .maybeSingle();
  if (!s || s.uploader_id !== viewer.userId) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const t = s.templates as unknown as { publication_status: string; cover_screenshot_id: string | null };
  if (t.publication_status === "removed") {
    return NextResponse.json({ error: "removed", message: "Removed listings cannot be changed." }, { status: 409 });
  }
  if (t.publication_status === "approved") {
    const { count } = await admin
      .from("template_screenshots")
      .select("id", { count: "exact", head: true })
      .eq("template_id", s.template_id)
      .eq("status", "ready");
    if ((count ?? 0) <= 1) {
      return NextResponse.json({ error: "last_screenshot", message: "Published listings need at least one screenshot. Add another before deleting this one." }, { status: 409 });
    }
  }
  await admin.from("template_screenshots").delete().eq("id", s.id);
  if (t.cover_screenshot_id === s.id) {
    const { data: next } = await admin
      .from("template_screenshots")
      .select("id")
      .eq("template_id", s.template_id)
      .eq("status", "ready")
      .order("position")
      .limit(1)
      .maybeSingle();
    await admin.from("templates").update({ cover_screenshot_id: next?.id ?? null }).eq("id", s.template_id);
  }
  await storage.remove(s.original_bucket === "quarantine" ? "quarantine" : "screenshot-uploads", [s.original_key]);
  await storage.remove("previews", [s.public_key, s.thumb_key].filter((k): k is string => !!k));
  return NextResponse.json({ ok: true });
}
