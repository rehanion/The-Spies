"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer, isAdmin, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cleanupStorage } from "@/lib/storage-cleanup";
import { unpublishPreviews } from "@/lib/previews";
import { invalidateCatalog } from "@/lib/data/catalog";

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

/** Deletes stale upload reservations and orphaned objects, and frees their quota. */
export async function cleanupStaleUploads(): Promise<AdminState> {
  const viewer = await getViewer();
  if (!isStaff(viewer)) return { ok: false, message: "Staff only." };
  const supabase = await createClient();
  const { data: staff } = await supabase.rpc("is_staff");
  if (!staff) return { ok: false, message: "Staff only." };
  try {
    const r = await cleanupStorage();
    revalidatePath("/admin");
    return {
      ok: true,
      message: `Removed ${r.files} stale file reservations, ${r.screenshots} screenshots, ${r.avatars} avatar reservations and ${r.orphans} unused stored objects.`,
    };
  } catch {
    return { ok: false, message: "The cleanup could not run. Try again later." };
  }
}

export async function setAutoPublish(enabled: boolean): Promise<AdminState> {
  const viewer = await getViewer();
  if (!isAdmin(viewer)) return { ok: false, message: "Admins only." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_auto_publish", { p_enabled: enabled });
  if (error) return { ok: false, message: "Could not change the setting." };
  revalidatePath("/admin");
  return { ok: true, message: enabled ? "Uploads now go live automatically after a clean scan." : "Uploads now wait for your approval." };
}

const catalogId = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens.").min(2).max(32);
const formatList = (v: FormDataEntryValue[]) => v.map(String).filter((x) => /^[a-z0-9]{1,16}$/.test(x));

export async function savePlatform(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const viewer = await getViewer();
  if (!isAdmin(viewer)) return { ok: false, message: "Admins only." };
  const parsed = z
    .object({
      id: catalogId,
      name: z.string().trim().min(2, "Name is too short.").max(40),
      website: z.union([z.literal(""), z.url({ protocol: /^https$/ }).max(200)]),
      description: z.string().trim().max(300),
      install_hint: z.string().trim().max(500),
      sort_order: z.coerce.number().int().min(0).max(1000),
    })
    .safeParse({
      id: formData.get("id"),
      name: formData.get("name"),
      website: String(formData.get("website") ?? "").trim(),
      description: formData.get("description") ?? "",
      install_hint: formData.get("install_hint") ?? "",
      sort_order: formData.get("sort_order") || 100,
    });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
  const upload = formatList(formData.getAll("upload_formats"));
  const zip = formatList(formData.getAll("zip_formats"));
  if (!upload.length) return { ok: false, message: "Choose at least one file type." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_platform", {
    p_id: parsed.data.id,
    p_name: parsed.data.name,
    p_website: parsed.data.website,
    p_description: parsed.data.description,
    p_install_hint: parsed.data.install_hint,
    p_upload_formats: upload,
    p_zip_formats: zip.filter((x) => x !== "zip" && x !== "jar"),
    p_sort_order: parsed.data.sort_order,
    p_is_active: formData.get("is_active") === "on",
  });
  if (error) return { ok: false, message: "Could not save the platform. Check the fields and try again." };
  invalidateCatalog();
  revalidatePath("/", "layout");
  return { ok: true, message: `Saved ${parsed.data.name}.` };
}

export async function saveCategory(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const viewer = await getViewer();
  if (!isAdmin(viewer)) return { ok: false, message: "Admins only." };
  const parsed = z
    .object({
      id: catalogId,
      name: z.string().trim().min(2, "Name is too short.").max(40),
      description: z.string().trim().max(300),
      sort_order: z.coerce.number().int().min(0).max(1000),
    })
    .safeParse({
      id: formData.get("id"),
      name: formData.get("name"),
      description: formData.get("description") ?? "",
      sort_order: formData.get("sort_order") || 100,
    });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_category", {
    p_id: parsed.data.id,
    p_name: parsed.data.name,
    p_description: parsed.data.description,
    p_sort_order: parsed.data.sort_order,
  });
  if (error) return { ok: false, message: "Could not save the category." };
  invalidateCatalog();
  revalidatePath("/", "layout");
  return { ok: true, message: `Saved ${parsed.data.name}.` };
}

export async function deleteCategory(id: string): Promise<AdminState> {
  const viewer = await getViewer();
  if (!isAdmin(viewer)) return { ok: false, message: "Admins only." };
  if (!catalogId.safeParse(id).success) return { ok: false, message: "Unknown category." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_delete_category", { p_id: id });
  if (error) return { ok: false, message: error.code === "P0001" ? "Listings use this category. Rename it instead." : "Could not delete the category." };
  invalidateCatalog();
  revalidatePath("/", "layout");
  return { ok: true, message: "Category deleted." };
}
