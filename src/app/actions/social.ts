"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer } from "@/lib/auth";
import { consumeRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export type SocialResult = { ok: boolean; message: string; following?: boolean };

export async function toggleFollow(creatorId: string, follow: boolean): Promise<SocialResult> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, message: "Sign in to follow creators." };
  if (!z.uuid().safeParse(creatorId).success) return { ok: false, message: "Invalid request." };
  if (creatorId === viewer.userId) return { ok: false, message: "You cannot follow yourself." };
  if (!(await consumeRateLimit("follow", viewer.userId))) return { ok: false, message: "Too many requests. Try again later." };
  const supabase = await createClient();
  const { error } = follow
    ? await supabase.from("follows").insert({ follower_id: viewer.userId, creator_id: creatorId })
    : await supabase.from("follows").delete().eq("follower_id", viewer.userId).eq("creator_id", creatorId);
  if (error && error.code !== "23505") {
    return { ok: false, message: error.message.includes("limit") ? "Follow limit reached for today." : "Could not update." };
  }
  revalidatePath("/feed");
  return { ok: true, message: follow ? "Following" : "Unfollowed", following: follow };
}
