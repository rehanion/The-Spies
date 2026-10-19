import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type Profile = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "username" | "display_name" | "bio" | "avatar_key" | "role" | "is_banned" | "is_demo" | "created_at"
>;

export interface Viewer {
  userId: string;
  email: string | null;
  profile: Profile | null;
}

/**
 * The current user, verified from the JWT signature (getClaims). The role is
 * read from public.profiles, never from user-editable JWT metadata.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  const userId = data.claims.sub;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, display_name, bio, avatar_key, role, is_banned, is_demo, created_at")
    .eq("id", userId)
    .maybeSingle();
  return { userId, email: (data.claims.email as string | undefined) ?? null, profile: profile ?? null };
});

export async function requireViewer(nextPath: string): Promise<Viewer & { profile: Profile }> {
  const viewer = await getViewer();
  if (!viewer || !viewer.profile) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return viewer as Viewer & { profile: Profile };
}

export function isStaff(viewer: Viewer | null): boolean {
  return !!viewer?.profile && !viewer.profile.is_banned && (viewer.profile.role === "admin" || viewer.profile.role === "moderator");
}

export function isAdmin(viewer: Viewer | null): boolean {
  return !!viewer?.profile && !viewer.profile.is_banned && viewer.profile.role === "admin";
}

/** Server-side gate for admin pages; RLS and SECURITY DEFINER checks still apply underneath. */
export async function requireStaff(nextPath: string): Promise<Viewer & { profile: Profile }> {
  const viewer = await requireViewer(nextPath);
  if (!isStaff(viewer)) redirect("/?denied=1");
  return viewer;
}
