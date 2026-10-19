"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-redirect";

export type AuthState = { ok: boolean; message: string } | null;

const USERNAME = /^[a-z0-9_]{3,24}$/;

function captcha(formData: FormData): string | undefined {
  const t = formData.get("turnstileToken");
  return typeof t === "string" && t ? t : undefined;
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = z
    .object({ email: z.email().max(254), password: z.string().min(1).max(200) })
    .safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { ok: false, message: "Enter your email and password." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    ...parsed.data,
    options: { captchaToken: captcha(formData) },
  });
  if (error) {
    if (error.code === "email_not_confirmed") return { ok: false, message: "Confirm your email address first. Check your inbox for the link." };
    if (error.status === 429) return { ok: false, message: "Too many attempts. Wait a few minutes and try again." };
    return { ok: false, message: "Email or password is incorrect." };
  }
  redirect(safeNextPath(formData.get("next"), "/dashboard"));
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = z
    .object({
      email: z.email().max(254),
      username: z.string().trim().toLowerCase().regex(USERNAME),
      password: z.string().min(10).max(200).regex(/[a-zA-Z]/).regex(/[0-9]/),
      rules: z.literal("on"),
    })
    .safeParse({
      email: formData.get("email"),
      username: formData.get("username"),
      password: formData.get("password"),
      rules: formData.get("rules"),
    });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const messages: Record<string, string> = {
      email: "Enter a valid email address.",
      username: "Usernames are 3–24 characters: lowercase letters, numbers and underscores.",
      password: "Passwords need at least 10 characters including a letter and a number.",
      rules: "You must accept the acceptable use rules.",
    };
    return { ok: false, message: messages[String(field)] ?? "Check the form and try again." };
  }
  const supabase = await createClient();
  const { data: taken } = await supabase.from("profiles").select("id").eq("username", parsed.data.username).maybeSingle();
  if (taken) return { ok: false, message: "That username is taken." };
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { username: parsed.data.username },
      emailRedirectTo: `${publicEnv.siteUrl()}/auth/confirm?next=/dashboard`,
      captchaToken: captcha(formData),
    },
  });
  if (error) {
    if (error.status === 429) return { ok: false, message: "Too many signups right now (email sending is rate limited on the free plan). Try again later." };
    if (error.code === "weak_password") return { ok: false, message: "Choose a stronger password." };
    return { ok: false, message: "Sign-up failed. If you already have an account, sign in instead." };
  }
  // With email confirmation turned off (no custom SMTP yet) the account is active straight away.
  if (data.session) redirect("/dashboard");
  return { ok: true, message: "Check your email for a confirmation link to activate your account." };
}

export async function requestPasswordReset(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = z.email().max(254).safeParse(formData.get("email"));
  if (!email.success) return { ok: false, message: "Enter a valid email address." };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${publicEnv.siteUrl()}/auth/confirm?next=/reset-password`,
    captchaToken: captcha(formData),
  });
  // Same response whether or not the account exists (no account enumeration).
  return { ok: true, message: "If an account exists for that address, a reset link is on its way." };
}

export async function updatePassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const password = z.string().min(10).max(200).regex(/[a-zA-Z]/).regex(/[0-9]/).safeParse(formData.get("password"));
  if (!password.success) return { ok: false, message: "Passwords need at least 10 characters including a letter and a number." };
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return { ok: false, message: "Your reset link expired. Request a new one." };
  const { error } = await supabase.auth.updateUser({ password: password.data });
  if (error) return { ok: false, message: "Could not update the password. Request a new reset link." };
  redirect("/dashboard?password=updated");
}
