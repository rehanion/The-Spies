"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer, isAdmin, isStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { storage } from "@/lib/storage";
import { unpublishPreviews } from "@/lib/previews";

export type AdminState = { ok: boolean; message: string } | null;

// Every action below calls a SECURITY DEFINER database function that checks
// the caller's role in public.profiles. The UI checks are only for messages.

const scanSchema = z.object({
  fileId: z.uuid(),
  templateId: z.uuid(),
  result: z.enum(["clean", "flagged", "error"]),
  scannerName: z.string().trim().min(1).max(60),
  scannerVersion: z.string().trim().min(1, "Enter the scanner engine version.").max(120),
  signatureVersion: z.string().trim().min(1, "Enter the signature database version/date.").max(200),
  sha256: z.string().trim().regex(/^[0-9a-fA-F]{64}$/, "Enter the 64-character SHA-256 of the file you scanned."),
  scannedAt: z.string().trim().min(1),
  notes: z.string().max(2000),
  rawOutput: z.string().max(8000),
});

export async function recordScan(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const viewer = await getViewer();
  if (!isStaff(viewer)) return { ok: false, message: "Staff only." };
  const parsed = scanSchema.safeParse({
    fileId: formData.get("fileId"),
    templateId: formData.get("templateId"),
    result: formData.get("result"),
    scannerName: formData.get("scannerName"),
    scannerVersion: formData.get("scannerVersion"),
    signatureVersion: formData.get("signatureVersion"),
    sha256: formData.get("sha256"),
    scannedAt: formData.get("scannedAt"),
    notes: formData.get("notes") ?? "",
    rawOutput: formData.get("rawOutput") ?? "",
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the scan form." };
  const scannedAt = new Date(parsed.data.scannedAt);
  if (Number.isNaN(scannedAt.getTime())) return { ok: false, message: "Enter a valid scan time." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_scan_result", {
    p_file_id: parsed.data.fileId,
    p_result: parsed.data.result,
    p_scanner_name: parsed.data.scannerName,
    p_scanner_version: parsed.data.scannerVersion,
    p_signature_version: parsed.data.signatureVersion,
    p_scanned_sha256: parsed.data.sha256.toLowerCase(),
    p_scanned_at: scannedAt.toISOString(),
    p_notes: parsed.data.notes,
    p_raw_output: parsed.data.rawOutput,
  });
  revalidatePath(`/admin/submissions/${parsed.data.templateId}`);
  if (error) return { ok: false, message: error.message };
  if (data === "error" && parsed.data.result !== "error") {
    return { ok: false, message: "Hash mismatch: the file you scanned is not the stored object. Recorded as a scan error; approval is blocked." };
  }
  return { ok: true, message: `Scan recorded: ${data}.` };
}

const moderateSchema = z.object({
  templateId: z.uuid(),
  action: z.enum(["approve", "reject", "remove"]),
  reason: z.string().trim().max(2000),
});

export async function moderate(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const viewer = await getViewer();
  if (!isStaff(viewer)) return { ok: false, message: "Staff only." };
  const parsed = moderateSchema.safeParse({
    templateId: formData.get("templateId"),
    action: formData.get("action"),
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) return { ok: false, message: "Invalid moderation request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("moderate_template", {
    p_template_id: parsed.data.templateId,
    p_action: parsed.data.action,
    p_reason: parsed.data.reason,
  });
  revalidatePath(`/admin/submissions/${parsed.data.templateId}`);
  revalidatePath("/admin/queue");
  revalidatePath("/");
  if (error) return { ok: false, message: error.message };
  if (parsed.data.action === "remove") {
    // Removed listings must not keep public previews online.
    await unpublishPreviews(parsed.data.templateId);
  }
  return { ok: true, message: { approve: "Approved and published.", reject: "Rejected.", remove: "Removed." }[parsed.data.action] };
}

export async function resolveReport(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const viewer = await getViewer();
  if (!isStaff(viewer)) return { ok: false, message: "Staff only." };
  const parsed = z
    .object({ reportId: z.uuid(), status: z.enum(["resolved", "dismissed"]), note: z.string().trim().max(2000) })
    .safeParse({ reportId: formData.get("reportId"), status: formData.get("status"), note: formData.get("note") ?? "" });
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_report", {
    p_report_id: parsed.data.reportId,
    p_status: parsed.data.status,
    p_note: parsed.data.note,
  });
  revalidatePath("/admin/reports");
  return error ? { ok: false, message: error.message } : { ok: true, message: "Report updated." };
}

export async function setUserRole(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const viewer = await getViewer();
  if (!isAdmin(viewer)) return { ok: false, message: "Admins only." };
  const parsed = z
    .object({ userId: z.uuid(), role: z.enum(["user", "moderator", "admin"]) })
    .safeParse({ userId: formData.get("userId"), role: formData.get("role") });
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_user_role", { p_user_id: parsed.data.userId, p_role: parsed.data.role });
  revalidatePath("/admin/users");
  return error ? { ok: false, message: error.message } : { ok: true, message: "Role updated." };
}

export async function setUserBanned(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const viewer = await getViewer();
  if (!isStaff(viewer)) return { ok: false, message: "Staff only." };
  const parsed = z
    .object({ userId: z.uuid(), banned: z.enum(["true", "false"]), reason: z.string().trim().max(500) })
    .safeParse({ userId: formData.get("userId"), banned: formData.get("banned"), reason: formData.get("reason") ?? "" });
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_banned", {
    p_user_id: parsed.data.userId,
    p_banned: parsed.data.banned === "true",
    p_reason: parsed.data.reason,
  });
  revalidatePath("/admin/users");
  return error ? { ok: false, message: error.message } : { ok: true, message: parsed.data.banned === "true" ? "User suspended." : "Suspension lifted." };
}

/** Deletes upload reservations that never completed (older than 24h) and frees their quota. */
export async function cleanupStaleUploads(): Promise<AdminState> {
  const viewer = await getViewer();
  if (!isStaff(viewer)) return { ok: false, message: "Staff only." };
  const supabase = await createClient();
  const { data: staff } = await supabase.rpc("is_staff");
  if (!staff) return { ok: false, message: "Staff only." };
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [{ data: files }, { data: shots }] = await Promise.all([
    admin.from("template_files").select("id, storage_key").eq("validation_status", "pending").lt("created_at", cutoff).limit(500),
    admin.from("template_screenshots").select("id, original_key").eq("status", "pending").lt("created_at", cutoff).limit(500),
  ]);
  await storage.remove("quarantine", [...(files ?? []).map((f) => f.storage_key), ...(shots ?? []).map((s) => s.original_key)]);
  if (files?.length) await admin.from("template_files").delete().in("id", files.map((f) => f.id));
  if (shots?.length) await admin.from("template_screenshots").delete().in("id", shots.map((s) => s.id));
  await admin.rpc("log_event", {
    p_action: "maintenance:cleanup_stale_uploads",
    p_template_id: null as unknown as string,
    p_file_id: null as unknown as string,
    p_details: { files: files?.length ?? 0, screenshots: shots?.length ?? 0, actor: viewer!.userId },
  });
  revalidatePath("/admin");
  return { ok: true, message: `Removed ${files?.length ?? 0} stale file reservations and ${shots?.length ?? 0} screenshots.` };
}
