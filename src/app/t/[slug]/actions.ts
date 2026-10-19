"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer } from "@/lib/auth";
import { consumeRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { ok: boolean; message: string } | null;

const uuid = z.uuid();
const slugSchema = z.string().regex(/^[a-z0-9-]{1,96}$/);

export async function toggleFavorite(templateId: string, slug: string, favorite: boolean): Promise<ActionState> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, message: "Sign in to save favorites." };
  if (!uuid.safeParse(templateId).success || !slugSchema.safeParse(slug).success) return { ok: false, message: "Invalid request." };
  if (!(await consumeRateLimit("favorite", viewer.userId))) return { ok: false, message: "Too many requests. Try again later." };
  const supabase = await createClient();
  const { error } = favorite
    ? await supabase.from("favorites").insert({ user_id: viewer.userId, template_id: templateId })
    : await supabase.from("favorites").delete().eq("user_id", viewer.userId).eq("template_id", templateId);
  if (error && error.code !== "23505") return { ok: false, message: "Could not update favorites." };
  revalidatePath(`/t/${slug}`);
  revalidatePath("/library");
  return { ok: true, message: favorite ? "Saved to favorites." : "Removed from favorites." };
}

const reviewSchema = z.object({
  templateId: uuid,
  slug: slugSchema,
  rating: z.coerce.number().int().min(1).max(5),
  body: z.string().trim().max(2000),
});

export async function saveReview(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, message: "Sign in to write a review." };
  const parsed = reviewSchema.safeParse({
    templateId: formData.get("templateId"),
    slug: formData.get("slug"),
    rating: formData.get("rating"),
    body: formData.get("body") ?? "",
  });
  if (!parsed.success) return { ok: false, message: "Choose a rating from 1 to 5 and keep the review under 2000 characters." };
  if (!(await consumeRateLimit("review", viewer.userId))) return { ok: false, message: "Too many reviews. Try again later." };
  const { templateId, slug, rating, body } = parsed.data;
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("reviews")
    .select("id")
    .eq("template_id", templateId)
    .eq("author_id", viewer.userId)
    .maybeSingle();
  const { error } = existing
    ? await supabase.from("reviews").update({ rating, body }).eq("id", existing.id)
    : await supabase.from("reviews").insert({ template_id: templateId, author_id: viewer.userId, rating, body });
  if (error) {
    if (error.message.includes("own template")) return { ok: false, message: "You cannot review your own template." };
    if (error.message.includes("Review limit")) return { ok: false, message: "Daily review limit reached. Try again tomorrow." };
    return { ok: false, message: "Your review could not be saved. Reviews are only possible on approved listings." };
  }
  revalidatePath(`/t/${slug}`);
  return { ok: true, message: existing ? "Review updated." : "Thanks, your review is published." };
}

export async function deleteReview(reviewId: string, slug: string): Promise<ActionState> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, message: "Sign in first." };
  if (!uuid.safeParse(reviewId).success || !slugSchema.safeParse(slug).success) return { ok: false, message: "Invalid request." };
  const supabase = await createClient();
  const { error, count } = await supabase.from("reviews").delete({ count: "exact" }).eq("id", reviewId);
  if (error || !count) return { ok: false, message: "Could not delete the review." };
  revalidatePath(`/t/${slug}`);
  return { ok: true, message: "Review deleted." };
}
