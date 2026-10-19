import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getViewer, isStaff } from "@/lib/auth";
import { storage } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sanitizeFilename } from "@shared/filename.ts";

// Staff-only retrieval of the exact quarantined object for manual scanning.
// The role is checked in the database (is_staff), not from the UI.
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/admin/files/[id]/download">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const viewer = await getViewer();
  if (!isStaff(viewer)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const supabase = await createClient();
  const { data: staff } = await supabase.rpc("is_staff");
  if (!staff) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data: file } = await supabase
    .from("template_files")
    .select("id, template_id, storage_key, original_filename, sha256, validation_status, is_current")
    .eq("id", id)
    .maybeSingle();
  if (!file || file.validation_status !== "passed") return NextResponse.json({ error: "not_found" }, { status: 404 });

  const admin = createAdminClient();
  await admin.rpc("log_event", {
    p_action: "file:retrieved_for_scan",
    p_template_id: file.template_id,
    p_file_id: file.id,
    p_details: { actor: viewer!.userId, sha256: file.sha256 },
  });
  // Name the download after the hash so the admin scans exactly this object.
  const url = await storage.createDownloadUrl("quarantine", file.storage_key, 120, sanitizeFilename(`${file.sha256?.slice(0, 12)}-${file.original_filename}`) ?? `${file.sha256?.slice(0, 12)}.bin`);
  return NextResponse.redirect(url, { status: 303, headers: { "cache-control": "no-store" } });
}
