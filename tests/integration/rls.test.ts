// Database security tests against a local Supabase stack (`npx supabase start`).
// They use real anon/authenticated sessions, so RLS, column grants, triggers
// and SECURITY DEFINER checks are exercised exactly as in production.
// Run with: npm run test:integration
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";

// Next skips .env.local when NODE_ENV=test, so read the local values directly.
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
} catch {
  // No .env.local: rely on the environment.
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET = process.env.SUPABASE_SECRET_KEY!;
const enabled = !!(URL && PUBLISHABLE && SECRET) && /127\.0\.0\.1|localhost/.test(URL ?? "");

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service = () => createClient<Database>(URL, SECRET, opts);
const anon = () => createClient<Database>(URL, PUBLISHABLE, opts);
const sha = () => randomBytes(32).toString("hex");

async function user(role: "user" | "moderator" | "admin" = "user") {
  const username = `it${randomBytes(5).toString("hex")}`;
  const email = `${username}@example.test`;
  const password = "integration-Passw0rd";
  const { data, error } = await service().auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username } });
  if (error) throw error;
  if (role !== "user") await service().from("profiles").update({ role }).eq("id", data.user!.id);
  const client = anon();
  const { error: e2 } = await client.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return { id: data.user!.id, client, username };
}

/** A submitted listing with one validated file and one ready screenshot. */
async function pendingListing(creatorId: string) {
  const db = service();
  const id = randomUUID();
  const { error } = await db.from("templates").insert({
    id,
    slug: `it-${randomBytes(4).toString("hex")}`,
    creator_id: creatorId,
    title: "Integration listing",
    platform_id: "quantower",
    category_id: "footprint",
    rights_attested: true,
  });
  if (error) throw error;
  const fileId = randomUUID();
  const hash = sha();
  await db.from("template_files").insert({
    id: fileId,
    template_id: id,
    uploader_id: creatorId,
    storage_key: `files/${id}/${randomUUID()}.bin`,
    original_filename: "w.xml",
    extension: "xml",
    declared_size_bytes: 10,
  });
  await db.from("template_files").update({ size_bytes: 10, sha256: hash, validation_status: "passed" }).eq("id", fileId);
  const shotId = randomUUID();
  await db.from("template_screenshots").insert({
    id: shotId,
    template_id: id,
    uploader_id: creatorId,
    original_key: `screenshots/${id}/${randomUUID()}.bin`,
    declared_size_bytes: 10,
  });
  await db
    .from("template_screenshots")
    .update({ status: "ready", public_key: `shots/${id}/${randomUUID()}.jpg`, thumb_key: `shots/${id}/${randomUUID()}.jpg` })
    .eq("id", shotId);
  return { id, fileId, hash };
}

describe.skipIf(!enabled)("row level security and workflow guards", () => {
  let creator: Awaited<ReturnType<typeof user>>;
  let other: Awaited<ReturnType<typeof user>>;
  let moderator: Awaited<ReturnType<typeof user>>;
  let admin: Awaited<ReturnType<typeof user>>;

  beforeAll(async () => {
    [creator, other, moderator, admin] = await Promise.all([user(), user(), user("moderator"), user("admin")]);
  });

  it("users cannot raise their own role, unban themselves or mark demo content", async () => {
    for (const patch of [{ role: "admin" }, { is_banned: false }, { is_demo: true }, { avatar_key: "avatars/x.jpg" }] as const) {
      const { error } = await creator.client.from("profiles").update(patch as never).eq("id", creator.id);
      expect(error, JSON.stringify(patch)).not.toBeNull();
    }
    const { data } = await service().from("profiles").select("role").eq("id", creator.id).single();
    expect(data?.role).toBe("user");
    const { error } = await creator.client.rpc("admin_set_user_role", { p_user_id: creator.id, p_role: "admin" });
    expect(error).not.toBeNull();
  });

  it("users can edit their own profile fields but not someone else's", async () => {
    expect((await creator.client.from("profiles").update({ bio: "hello" }).eq("id", creator.id)).error).toBeNull();
    await other.client.from("profiles").update({ bio: "hacked" }).eq("id", creator.id);
    const { data } = await service().from("profiles").select("bio").eq("id", creator.id).single();
    expect(data?.bio).toBe("hello");
  });

  it("drafts and pending listings are private to the creator and staff", async () => {
    const l = await pendingListing(creator.id);
    expect((await anon().from("templates").select("id").eq("id", l.id)).data).toEqual([]);
    expect((await other.client.from("templates").select("id").eq("id", l.id)).data).toEqual([]);
    expect((await creator.client.from("templates").select("id").eq("id", l.id)).data).toHaveLength(1);
    expect((await moderator.client.from("templates").select("id").eq("id", l.id)).data).toHaveLength(1);
    expect((await anon().from("template_files").select("id").eq("id", l.fileId)).data).toEqual([]);
  });

  it("creators cannot publish, edit moderation fields or touch other listings", async () => {
    const l = await pendingListing(creator.id);
    expect((await creator.client.from("templates").update({ publication_status: "approved" } as never).eq("id", l.id)).error).not.toBeNull();
    expect((await creator.client.from("templates").update({ download_count: 999 } as never).eq("id", l.id)).error).not.toBeNull();
    expect((await creator.client.rpc("moderate_template", { p_template_id: l.id, p_action: "approve" })).error).not.toBeNull();
    await other.client.from("templates").update({ title: "Hijacked" }).eq("id", l.id);
    expect((await service().from("templates").select("title").eq("id", l.id).single()).data?.title).toBe("Integration listing");
    // Clients cannot write file records or scan results directly.
    expect((await creator.client.from("template_files").update({ scan_status: "clean" } as never).eq("id", l.fileId)).error).not.toBeNull();
    expect(
      (await creator.client.rpc("record_scan_result", {
        p_file_id: l.fileId, p_result: "clean", p_scanner_name: "ClamAV", p_scanner_version: "x", p_signature_version: "x", p_scanned_sha256: l.hash,
      })).error,
    ).not.toBeNull();
  });

  it("approval needs a clean scan of the exact stored hash", async () => {
    const l = await pendingListing(creator.id);
    await service().from("templates").update({ publication_status: "pending" }).eq("id", l.id);
    expect((await moderator.client.rpc("moderate_template", { p_template_id: l.id, p_action: "approve" })).error).not.toBeNull();

    // A scan of different bytes is stored as an error and cannot be approved.
    const wrong = await moderator.client.rpc("record_scan_result", {
      p_file_id: l.fileId, p_result: "clean", p_scanner_name: "ClamAV", p_scanner_version: "1.5.4", p_signature_version: "d1", p_scanned_sha256: sha(),
    });
    expect(wrong.data).toBe("error");
    expect((await moderator.client.rpc("moderate_template", { p_template_id: l.id, p_action: "approve" })).error).not.toBeNull();

    const right = await moderator.client.rpc("record_scan_result", {
      p_file_id: l.fileId, p_result: "clean", p_scanner_name: "ClamAV", p_scanner_version: "1.5.4", p_signature_version: "d1", p_scanned_sha256: l.hash,
    });
    expect(right.data).toBe("clean");
    expect((await moderator.client.rpc("moderate_template", { p_template_id: l.id, p_action: "approve" })).error).toBeNull();
    expect((await anon().rpc("file_download_state", { p_file_id: l.fileId })).data).toBe("ok");
    expect((await anon().from("templates").select("id").eq("id", l.id)).data).toHaveLength(1);

    // If the stored bytes change (hash differs), the scan resets and downloads stop.
    await service().from("template_files").update({ sha256: sha() }).eq("id", l.fileId);
    expect((await anon().rpc("file_download_state", { p_file_id: l.fileId })).data).not.toBe("ok");

    // Editing an approved listing sends it back to review.
    const l2 = await pendingListing(creator.id);
    await service().from("templates").update({ publication_status: "pending" }).eq("id", l2.id);
    await admin.client.rpc("record_scan_result", {
      p_file_id: l2.fileId, p_result: "clean", p_scanner_name: "ClamAV", p_scanner_version: "1.5.4", p_signature_version: "d1", p_scanned_sha256: l2.hash,
    });
    expect((await admin.client.rpc("moderate_template", { p_template_id: l2.id, p_action: "approve" })).error).toBeNull();
    expect((await creator.client.from("templates").update({ description: "changed after approval" }).eq("id", l2.id)).error).toBeNull();
    expect((await service().from("templates").select("publication_status").eq("id", l2.id).single()).data?.publication_status).toBe("pending");
  });

  it("flagged files block approval and downloads", async () => {
    const l = await pendingListing(creator.id);
    await service().from("templates").update({ publication_status: "pending" }).eq("id", l.id);
    await moderator.client.rpc("record_scan_result", {
      p_file_id: l.fileId, p_result: "flagged", p_scanner_name: "ClamAV", p_scanner_version: "1.5.4", p_signature_version: "d1", p_scanned_sha256: l.hash,
    });
    expect((await moderator.client.rpc("moderate_template", { p_template_id: l.id, p_action: "approve" })).error).not.toBeNull();
    expect((await anon().rpc("file_download_state", { p_file_id: l.fileId })).data).not.toBe("ok");
  });

  it("only admins manage roles and moderators cannot", async () => {
    expect((await moderator.client.rpc("admin_set_user_role", { p_user_id: other.id, p_role: "moderator" })).error).not.toBeNull();
    expect((await admin.client.rpc("admin_set_user_role", { p_user_id: admin.id, p_role: "user" })).error).not.toBeNull();
    expect((await admin.client.rpc("admin_set_user_role", { p_user_id: other.id, p_role: "moderator" })).error).toBeNull();
    await admin.client.rpc("admin_set_user_role", { p_user_id: other.id, p_role: "user" });
  });

  it("reviews: no self-review, one per user, only on public listings", async () => {
    const l = await pendingListing(creator.id);
    expect((await other.client.from("reviews").insert({ template_id: l.id, author_id: other.id, rating: 5 })).error).not.toBeNull();
    await service().from("templates").update({ publication_status: "pending" }).eq("id", l.id);
    await admin.client.rpc("record_scan_result", {
      p_file_id: l.fileId, p_result: "clean", p_scanner_name: "ClamAV", p_scanner_version: "1", p_signature_version: "d", p_scanned_sha256: l.hash,
    });
    await admin.client.rpc("moderate_template", { p_template_id: l.id, p_action: "approve" });
    expect((await creator.client.from("reviews").insert({ template_id: l.id, author_id: creator.id, rating: 5 })).error).not.toBeNull();
    expect((await other.client.from("reviews").insert({ template_id: l.id, author_id: other.id, rating: 4 })).error).toBeNull();
    expect((await other.client.from("reviews").insert({ template_id: l.id, author_id: other.id, rating: 5 })).error).not.toBeNull();
    expect((await other.client.from("reviews").insert({ template_id: l.id, author_id: creator.id, rating: 1 })).error).not.toBeNull();
    const { data } = await service().from("templates").select("rating_count, rating_avg").eq("id", l.id).single();
    expect(data).toMatchObject({ rating_count: 1 });
    expect(Number(data?.rating_avg)).toBe(4);
  });

  it("download counts are de-duplicated and cannot be called by clients", async () => {
    const l = await pendingListing(creator.id);
    expect((await other.client.rpc("register_download", { p_file_id: l.fileId, p_actor_hash: "x", p_user_id: other.id })).error).not.toBeNull();
    expect((await other.client.from("templates").update({ download_count: 1000 } as never).eq("id", l.id)).error).not.toBeNull();
  });

  it("private data stays private", async () => {
    for (const table of ["reports", "moderation_events", "download_events", "scan_records", "rate_limits"] as const) {
      const { data } = await anon().from(table).select("*").limit(1);
      expect(data ?? [], table).toEqual([]);
    }
    const { data } = await other.client.from("moderation_events").select("*").limit(1);
    expect(data).toEqual([]);
    // Clients cannot insert reports directly; the server action does it after Turnstile and rate limiting.
    expect((await other.client.from("reports").insert({ kind: "spam", details: "direct insert attempt" })).error).not.toBeNull();
  });

  it("quarantine storage is not readable or writable by regular users", async () => {
    const l = await pendingListing(creator.id);
    const key = `files/${l.id}/${randomUUID()}.bin`;
    await service().storage.from("quarantine").upload(key, new Blob(["secret"]), { contentType: "application/octet-stream" });
    expect((await creator.client.storage.from("quarantine").download(key)).error).not.toBeNull();
    expect((await anon().storage.from("quarantine").createSignedUrl(key, 60)).error).not.toBeNull();
    expect((await creator.client.storage.from("quarantine").upload(`files/${l.id}/${randomUUID()}.bin`, new Blob(["x"]))).error).not.toBeNull();
    expect((await creator.client.storage.from("previews").upload(`shots/${l.id}/x.svg`, new Blob(["<svg/>"], { type: "image/svg+xml" }))).error).not.toBeNull();
    expect((await moderator.client.storage.from("quarantine").download(key)).error).toBeNull();
    await service().storage.from("quarantine").remove([key]);
  });
});
