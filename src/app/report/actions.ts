"use server";

import { z } from "zod";
import { getViewer } from "@/lib/auth";
import { consumeRateLimit } from "@/lib/rate-limit";
import { clientIp, ipHash } from "@/lib/request";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyTurnstile } from "@/lib/turnstile";

export type ReportState = { ok: boolean; message: string } | null;

const optionalText = (max: number) =>
  z.string().trim().max(max).transform((v) => (v.length ? v : null));

const reportSchema = z
  .object({
    kind: z.enum(["abuse", "malware", "copyright", "spam", "broken", "other"]),
    template: z.string().trim().max(96).regex(/^[a-z0-9-]*$/, "Invalid template address."),
    details: z.string().trim().min(10, "Please describe the problem in at least 10 characters.").max(4000),
    contact_email: z.union([z.literal(""), z.email().max(254)]).transform((v) => v || null),
    claimant_name: optionalText(120),
    original_work_url: z.union([z.literal(""), z.url({ protocol: /^https?$/ }).max(500)]).transform((v) => v || null),
    good_faith: z.boolean(),
    comment: z.union([z.literal(""), z.uuid()]).transform((v) => v || null),
  })
  .superRefine((v, ctx) => {
    if (v.kind !== "copyright") return;
    if (!v.claimant_name) ctx.addIssue({ code: "custom", path: ["claimant_name"], message: "Copyright complaints need the rights holder's name." });
    if (!v.contact_email) ctx.addIssue({ code: "custom", path: ["contact_email"], message: "Copyright complaints need a contact email." });
    if (!v.template) ctx.addIssue({ code: "custom", path: ["template"], message: "Name the listing that infringes." });
    if (!v.good_faith) ctx.addIssue({ code: "custom", path: ["good_faith"], message: "Please confirm the good-faith statement." });
  });

export async function submitReport(_prev: ReportState, formData: FormData): Promise<ReportState> {
  const viewer = await getViewer();
  if (viewer?.profile?.is_banned) return { ok: false, message: "Your account is suspended." };
  const parsed = reportSchema.safeParse({
    kind: formData.get("kind"),
    template: String(formData.get("template") ?? "").replace(/^.*\/t\//, "").replace(/[/?#].*$/, ""),
    details: formData.get("details") ?? "",
    contact_email: formData.get("contact_email") ?? "",
    claimant_name: formData.get("claimant_name") ?? "",
    original_work_url: formData.get("original_work_url") ?? "",
    good_faith: formData.get("good_faith") === "on",
    comment: formData.get("comment") ?? "",
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check the form." };

  const captcha = await verifyTurnstile(formData.get("turnstileToken"), await clientIp());
  if (!captcha.ok) return { ok: false, message: captcha.message };
  if (!(await consumeRateLimit("report", viewer?.userId ?? (await ipHash())))) {
    return { ok: false, message: "You have sent several reports recently. Please try again later." };
  }

  const r = parsed.data;
  // Reports are written by the server: anonymous visitors (e.g. rights holders)
  // can file them without an account, and clients have no insert privilege.
  const admin = createAdminClient();
  let templateId: string | null = null;
  if (r.template) {
    const { data } = await admin.from("templates").select("id").eq("slug", r.template).maybeSingle();
    if (!data) return { ok: false, message: "No listing exists at that address. Check the link and try again." };
    templateId = data.id;
  }
  const { data: report, error } = await admin
    .from("reports")
    .insert({
      template_id: templateId,
      template_slug: r.template || null,
      reporter_id: viewer?.userId ?? null,
      kind: r.kind,
      details: r.details,
      contact_email: r.contact_email ?? viewer?.email ?? null,
      claimant_name: r.claimant_name,
      original_work_url: r.original_work_url,
      good_faith_statement: r.good_faith,
      comment_id: r.comment,
    })
    .select("id")
    .single();
  if (error || !report) return { ok: false, message: "The report could not be saved. Please try again." };
  await admin.from("moderation_events").insert({
    actor_id: viewer?.userId ?? null,
    action: "report_created",
    template_id: templateId,
    details: { report_id: report.id, kind: r.kind },
  });
  return {
    ok: true,
    message:
      r.kind === "copyright"
        ? "Your complaint was received. A moderator will review it and may hide the listing while it is assessed."
        : "Thank you. A moderator will look at your report.",
  };
}
