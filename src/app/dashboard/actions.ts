"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getViewer } from "@/lib/auth";
import { consumeRateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { limits } from "@/lib/server-env";
import { randomSuffix, slugify } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { storage } from "@/lib/storage";
import { unpublishPreviews } from "@/lib/previews";
import { verifyTurnstile } from "@/lib/turnstile";
import { metadataFromForm } from "@/lib/validation/template";
import { getCatalog } from "@/lib/data/catalog";

export type FormState = { ok: boolean; message: string; fieldErrors?: Record<string, string> } | null;

function fieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const key = String(i.path[0] ?? "form");
    out[key] ??= i.message;
  }
  return out;
}

/** The platform must accept uploads and the category must exist. */
async function checkCatalogChoice(
  platformId: string,
  categoryId: string,
): Promise<{ ok: false; message: string; fieldErrors: Record<string, string> } | null> {
  const catalog = await getCatalog();
  if (!catalog.activePlatforms.some((x) => x.id === platformId)) {
    return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: { platform_id: "Choose a platform." } };
  }
  if (!catalog.hasCategory(categoryId)) {
    return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: { category_id: "Choose a category." } };
  }
  return null;
}

type CreateResult = { ok: true; id: string; slug: string } | { ok: false; message: string; fieldErrors?: Record<string, string> };

async function createTemplateRecord(formData: FormData): Promise<CreateResult> {
  const viewer = await getViewer();
  if (!viewer?.profile) return { ok: false, message: "Sign in to upload." };
  if (viewer.profile.is_banned) return { ok: false, message: "Your account is suspended." };

  const parsed = metadataFromForm(formData);
  if (!parsed.success) {
    return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error.issues) };
  }
  const catalogProblem = await checkCatalogChoice(parsed.data.platform_id, parsed.data.category_id);
  if (catalogProblem) return catalogProblem;
  const captcha = await verifyTurnstile(formData.get("turnstileToken"), await clientIp());
  if (!captcha.ok) return { ok: false, message: captcha.message };
  if (!(await consumeRateLimit("createSubmission", viewer.userId))) {
    return { ok: false, message: "You are creating uploads too quickly. Try again later." };
  }

  const supabase = await createClient();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await supabase
    .from("templates")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", viewer.userId)
    .gte("created_at", since);
  if ((count ?? 0) >= limits().perUserDailySubmissions) {
    return { ok: false, message: `You can create up to ${limits().perUserDailySubmissions} uploads per day.` };
  }

  const slug = `${slugify(parsed.data.title, 80)}-${randomSuffix(5)}`;
  const { data, error } = await supabase
    .from("templates")
    .insert({ ...parsed.data, slug, creator_id: viewer.userId })
    .select("id, slug")
    .single();
  if (error || !data) return { ok: false, message: "The upload could not be created. Please try again." };
  return { ok: true, id: data.id, slug: data.slug };
}

export async function createSubmission(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await createTemplateRecord(formData);
  if (!result.ok) return result;
  redirect(`/dashboard/submissions/${result.id}?created=1`);
}

/** Used by the one-page upload: creates the draft and returns its id so the browser can upload files next. */
export async function createUploadDraft(formData: FormData): Promise<CreateResult> {
  return createTemplateRecord(formData);
}

export async function updateSubmission(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await getViewer();
  if (!viewer?.profile) return { ok: false, message: "Sign in first." };
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { ok: false, message: "Invalid submission." };
  const parsed = metadataFromForm(formData);
  if (!parsed.success) {
    return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error.issues) };
  }
  const catalogProblem = await checkCatalogChoice(parsed.data.platform_id, parsed.data.category_id);
  if (catalogProblem) return catalogProblem;
  const supabase = await createClient();
  const { data: current } = await supabase
    .from("templates")
    .select("id, creator_id, publication_status, platform_id, slug")
    .eq("id", id.data)
    .maybeSingle();
  if (!current || current.creator_id !== viewer.userId) return { ok: false, message: "Submission not found." };
  if (current.publication_status === "removed") return { ok: false, message: "Removed listings cannot be edited." };

  if (parsed.data.platform_id !== current.platform_id) {
    const { data: files } = await supabase
      .from("template_files")
      .select("extension")
      .eq("template_id", current.id)
      .eq("is_current", true);
    const allowed = (await getCatalog()).rules(parsed.data.platform_id)?.upload ?? [];
    if ((files ?? []).some((f) => !allowed.includes(f.extension))) {
      return {
        ok: false,
        message: "Some uploaded files are not valid for the new platform. Remove them first.",
        fieldErrors: { platform_id: "Existing files do not match this platform." },
      };
    }
  }

  const { error } = await supabase.from("templates").update(parsed.data).eq("id", current.id);
  if (error) return { ok: false, message: "Changes could not be saved." };
  revalidatePath(`/dashboard/submissions/${current.id}`);
  revalidatePath(`/t/${current.slug}`);
  return {
    ok: true,
    message:
      current.publication_status === "approved"
        ? "Saved. Because the listing was already approved, it has gone back to moderation."
        : "Saved.",
  };
}

const idSchema = z.uuid();

export async function submitForReview(templateId: string): Promise<FormState> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, message: "Sign in first." };
  if (!idSchema.safeParse(templateId).success) return { ok: false, message: "Invalid submission." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_template", { p_template_id: templateId });
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/dashboard/submissions/${templateId}`);
  revalidatePath("/dashboard");
  const [{ data: after }, { data: settings }, { count: codeFiles }] = await Promise.all([
    supabase.from("templates").select("publication_status").eq("id", templateId).single(),
    supabase.from("site_settings").select("auto_publish").eq("id", 1).maybeSingle(),
    supabase.from("template_files").select("id", { count: "exact", head: true }).eq("template_id", templateId).eq("is_current", true).eq("contains_code", true),
  ]);
  return {
    ok: true,
    message: after?.publication_status === "approved"
      ? "Published! Your template is live."
      : settings?.auto_publish === false || (codeFiles ?? 0) > 0
        ? "Submitted. A moderator will review it after the virus scan."
        : "Submitted. It goes live automatically as soon as the virus scan has passed.",
  };
}

export async function withdrawSubmission(templateId: string): Promise<FormState> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, message: "Sign in first." };
  if (!idSchema.safeParse(templateId).success) return { ok: false, message: "Invalid submission." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_template", { p_template_id: templateId });
  if (error) return { ok: false, message: "Could not withdraw this listing." };
  await unpublishPreviews(templateId);
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/submissions/${templateId}`);
  return { ok: true, message: "Listing withdrawn. It is no longer public and its files cannot be downloaded." };
}

export async function deleteSubmission(templateId: string): Promise<FormState> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, message: "Sign in first." };
  if (!idSchema.safeParse(templateId).success) return { ok: false, message: "Invalid submission." };
  const supabase = await createClient();
  const { data: t } = await supabase
    .from("templates")
    .select("id, creator_id, publication_status")
    .eq("id", templateId)
    .maybeSingle();
  if (!t || t.creator_id !== viewer.userId) return { ok: false, message: "Submission not found." };
  if (!["draft", "pending", "rejected"].includes(t.publication_status)) {
    return { ok: false, message: "Approved listings must be withdrawn instead of deleted." };
  }
  // Collect storage keys before the rows disappear (service client, ownership already verified).
  const admin = createAdminClient();
  const [{ data: files }, { data: shots }] = await Promise.all([
    admin.from("template_files").select("storage_key").eq("template_id", t.id),
    admin.from("template_screenshots").select("original_bucket, original_key, public_key, thumb_key").eq("template_id", t.id),
  ]);
  const { error, count } = await supabase.from("templates").delete({ count: "exact" }).eq("id", t.id);
  if (error || !count) return { ok: false, message: "Could not delete the submission." };
  await storage.remove("quarantine", [
    ...(files ?? []).map((f) => f.storage_key),
    ...(shots ?? []).filter((s) => s.original_bucket === "quarantine").map((s) => s.original_key),
  ]);
  await storage.remove(
    "screenshot-uploads",
    (shots ?? []).filter((s) => s.original_bucket !== "quarantine").map((s) => s.original_key),
  );
  await storage.remove(
    "previews",
    (shots ?? []).flatMap((s) => [s.public_key, s.thumb_key]).filter((k): k is string => !!k),
  );
  await admin.rpc("log_event", { p_action: "template:deleted_by_creator", p_template_id: t.id, p_file_id: null as unknown as string, p_details: {} });
  revalidatePath("/dashboard");
  redirect("/dashboard?deleted=1");
}

export async function updateScreenshotCaption(screenshotId: string, caption: string): Promise<FormState> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, message: "Sign in first." };
  if (!idSchema.safeParse(screenshotId).success) return { ok: false, message: "Invalid screenshot." };
  const clean = caption.trim().slice(0, 200);
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("template_screenshots")
    .update({ caption: clean }, { count: "exact" })
    .eq("id", screenshotId);
  if (error || !count) return { ok: false, message: "Caption could not be saved." };
  return { ok: true, message: "Caption saved." };
}

export async function reorderScreenshots(templateId: string, ids: string[]): Promise<FormState> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, message: "Sign in first." };
  if (!idSchema.safeParse(templateId).success || !z.array(idSchema).max(50).safeParse(ids).success) {
    return { ok: false, message: "Invalid request." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_screenshots", { p_template_id: templateId, p_ids: ids });
  if (error) return { ok: false, message: "Order could not be saved." };
  revalidatePath(`/dashboard/submissions/${templateId}`);
  return { ok: true, message: "Order saved." };
}

export async function setCover(templateId: string, screenshotId: string): Promise<FormState> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, message: "Sign in first." };
  if (!idSchema.safeParse(templateId).success || !idSchema.safeParse(screenshotId).success) {
    return { ok: false, message: "Invalid request." };
  }
  const supabase = await createClient();
  const { data: shot } = await supabase
    .from("template_screenshots")
    .select("id, status")
    .eq("id", screenshotId)
    .eq("template_id", templateId)
    .maybeSingle();
  if (!shot || shot.status !== "ready") return { ok: false, message: "Only processed screenshots can be the cover." };
  const { error, count } = await supabase
    .from("templates")
    .update({ cover_screenshot_id: screenshotId }, { count: "exact" })
    .eq("id", templateId);
  if (error || !count) return { ok: false, message: "Cover could not be changed." };
  revalidatePath(`/dashboard/submissions/${templateId}`);
  return { ok: true, message: "Cover updated." };
}
