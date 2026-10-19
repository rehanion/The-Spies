"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { storage } from "@/lib/storage";

export type AccountState = { ok: boolean; message: string } | null;

const profileSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/, "3 to 24 lowercase letters, numbers or underscores."),
  display_name: z.string().trim().max(60, "At most 60 characters."),
  bio: z.string().trim().max(1000, "At most 1000 characters."),
});

export async function updateProfile(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const viewer = await getViewer();
  if (!viewer?.profile) return { ok: false, message: "Sign in first." };
  const parsed = profileSchema.safeParse({
    username: formData.get("username") ?? "",
    display_name: formData.get("display_name") ?? "",
    bio: formData.get("bio") ?? "",
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  const supabase = await createClient();
  // Column grants limit this update to username, display_name and bio.
  const { error } = await supabase.from("profiles").update(parsed.data).eq("id", viewer.userId);
  if (error) {
    if (error.code === "23505") return { ok: false, message: "That username is taken." };
    return { ok: false, message: "Your profile could not be saved." };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Profile saved." };
}

export async function removeAvatar(): Promise<AccountState> {
  const viewer = await getViewer();
  if (!viewer?.profile) return { ok: false, message: "Sign in first." };
  const key = viewer.profile.avatar_key;
  if (!key) return { ok: true, message: "No avatar to remove." };
  // avatar_key is not user-writable; the server clears it after verifying the session.
  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ avatar_key: null }).eq("id", viewer.userId);
  if (error) return { ok: false, message: "The avatar could not be removed." };
  await storage.remove("previews", [key]).catch(() => undefined);
  revalidatePath("/", "layout");
  return { ok: true, message: "Avatar removed." };
}

const emailSchema = z.email().max(254);

export async function changeEmail(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, message: "Sign in first." };
  const email = emailSchema.safeParse(String(formData.get("email") ?? "").trim());
  if (!email.success) return { ok: false, message: "Enter a valid email address." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ email: email.data });
  if (error) return { ok: false, message: "The email change could not be started. Please try again later." };
  return { ok: true, message: "Check both your old and new inboxes to confirm the change." };
}
