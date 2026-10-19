import { createHash, randomBytes } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { Image } from "imagescript";
import type { Page } from "@playwright/test";

loadEnvConfig(process.cwd());

export const MAILPIT = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";
export const PASSWORD = "e2e-Passw0rd-long";

export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("E2E needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (local stack only)");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function uniq(prefix: string) {
  return `${prefix}${randomBytes(4).toString("hex")}`;
}

export function sha256(buf: Uint8Array) {
  return createHash("sha256").update(buf).digest("hex");
}

export async function pngBytes(width = 800, height = 450, color = 0x1c2a3aff): Promise<Buffer> {
  const img = new Image(width, height);
  img.fill(color);
  for (let x = 0; x < width; x += 40) img.drawBox(x, height / 2, 20, height / 4, 0xd6a54aff);
  return Buffer.from(await img.encode());
}

/** Polls Mailpit for the newest message to `email` and returns the first SPIES link in it. */
export async function confirmationLink(email: string, path = "/auth/confirm"): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const data = (await res.json()) as { messages?: { ID: string }[] };
    const id = data.messages?.[0]?.ID;
    if (id) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { HTML?: string; Text?: string };
      const body = `${msg.HTML ?? ""}\n${msg.Text ?? ""}`;
      const m = body.match(new RegExp(`https?://[^"'\\s<>]*${path.replace(/\//g, "\\/")}[^"'\\s<>]*`));
      if (m) return m[0].replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email with ${path} for ${email}`);
}

/** Creates a confirmed user directly (service key, local only) and optionally grants a role. */
export async function createUser(username: string, role: "user" | "moderator" | "admin" = "user") {
  const db = serviceClient();
  const email = `${username}@example.test`;
  const { data, error } = await db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { username } });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  if (role !== "user") {
    const { error: e2 } = await db.from("profiles").update({ role }).eq("id", data.user.id);
    if (e2) throw e2;
  }
  return { id: data.user.id, email, username };
}

export async function login(page: Page, email: string, next = "/dashboard") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.pathname === next);
}

export async function logout(page: Page) {
  await page.context().clearCookies();
}
