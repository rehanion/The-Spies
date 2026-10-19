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
  if (viewer.profile?.is_banned) return { ok: false, message: "Your account is suspended." };
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

export type LikeResult = { ok: boolean; message: string; liked?: boolean; likeCount?: number };

export async function toggleLike(templateId: string, slug: string, like: boolean): Promise<LikeResult> {
  const viewer = await getViewer();
  if (!viewer?.profile) return { ok: false, message: "Sign in to like templates." };
  if (viewer.profile.is_banned) return { ok: false, message: "Your account is suspended." };
  if (!uuid.safeParse(templateId).success || !slugSchema.safeParse(slug).success) return { ok: false, message: "Invalid request." };
  if (!(await consumeRateLimit("like", viewer.userId))) return { ok: false, message: "Too many requests. Try again later." };
  const supabase = await createClient();
  const { error } = like
    ? await supabase.from("likes").insert({ user_id: viewer.userId, template_id: templateId })
    : await supabase.from("likes").delete().eq("user_id", viewer.userId).eq("template_id", templateId);
  // 23505: already liked, which is the state the viewer asked for.
  if (error && error.code !== "23505") {
    if (error.message.includes("own template")) return { ok: false, message: "You cannot like your own template." };
    if (error.message.includes("Like limit")) return { ok: false, message: "Daily like limit reached. Try again tomorrow." };
    return { ok: false, message: "Could not update your like." };
  }
  const { data } = await supabase.from("templates").select("like_count").eq("id", templateId).maybeSingle();
  revalidatePath(`/t/${slug}`);
  return { ok: true, message: like ? "Liked." : "Like removed.", liked: like, likeCount: data?.like_count };
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

const commentSchema = z.object({
  templateId: uuid,
  slug: slugSchema,
  parentId: z.union([z.literal(""), uuid]).transform((v) => v || null),
  body: z.string().trim().min(1, "Write something first.").max(2000, "Comments can be at most 2000 characters."),
});

export async function addComment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const viewer = await getViewer();
  if (!viewer?.profile) return { ok: false, message: "Sign in to comment." };
  if (viewer.profile.is_banned) return { ok: false, message: "Your account is suspended." };
  const parsed = commentSchema.safeParse({
    templateId: formData.get("templateId"),
    slug: formData.get("slug"),
    parentId: formData.get("parentId") ?? "",
    body: formData.get("body") ?? "",
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid comment." };
  if (!(await consumeRateLimit("comment", viewer.userId))) return { ok: false, message: "You are commenting too quickly. Try again later." };
  const { templateId, slug, parentId, body } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("comments").insert({ template_id: templateId, author_id: viewer.userId, parent_id: parentId, body });
  if (error) {
    if (error.message.includes("too quickly")) return { ok: false, message: "You are commenting too quickly. Please wait a while." };
    return { ok: false, message: "Your comment could not be posted." };
  }
  revalidatePath(`/t/${slug}`);
  return { ok: true, message: "Comment posted." };
}

export async function deleteComment(commentId: string, slug: string): Promise<ActionState> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, message: "Sign in first." };
  if (!uuid.safeParse(commentId).success || !slugSchema.safeParse(slug).success) return { ok: false, message: "Invalid request." };
  const supabase = await createClient();
  // RLS allows deleting your own comments; staff can delete any.
  const { error, count } = await supabase.from("comments").delete({ count: "exact" }).eq("id", commentId);
  if (error || !count) return { ok: false, message: "The comment could not be deleted." };
  revalidatePath(`/t/${slug}`);
  return { ok: true, message: "Comment deleted." };
}
