import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { storage } from "@/lib/storage";

/** Takes a removed listing's public preview images offline (keeps rows for the audit trail). */
export async function unpublishPreviews(templateId: string) {
  const admin = createAdminClient();
  const { data: shots } = await admin.from("template_screenshots").select("id, public_key, thumb_key").eq("template_id", templateId);
  const keys = (shots ?? []).flatMap((s) => [s.public_key, s.thumb_key]).filter((k): k is string => !!k);
  await storage.remove("previews", keys);
  await admin
    .from("template_screenshots")
    .update({ status: "failed", failure_reason: "Listing removed", public_key: null, thumb_key: null, public_size_bytes: 0 })
    .eq("template_id", templateId);
}
