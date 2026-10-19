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

  it("approval needs a clean scan of the exact stored hash (manual review mode)", async () => {
    await service().from("site_settings").update({ auto_publish: false }).eq("id", 1);
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
    await service().from("site_settings").update({ auto_publish: true }).eq("id", 1);
  });

  it("a file already on SPIES is flagged and its listing waits for a moderator", async () => {
    await service().from("site_settings").update({ auto_publish: true }).eq("id", 1);
    const scan = (fileId: string, hash: string) =>
      moderator.client.rpc("record_scan_result", {
        p_file_id: fileId, p_result: "clean", p_scanner_name: "ClamAV", p_scanner_version: "1", p_signature_version: "d", p_scanned_sha256: hash,
      });
    const status = async (id: string) => (await service().from("templates").select("publication_status").eq("id", id).single()).data?.publication_status;
    const first = await pendingListing(creator.id);
    const hash = sha();
    await service().from("template_files").update({ size_bytes: 500, sha256: hash }).eq("id", first.fileId);
    await creator.client.rpc("submit_template", { p_template_id: first.id });
    await scan(first.fileId, hash);
    expect(await status(first.id)).toBe("approved");

    const copy = await pendingListing(other.id);
    await service().from("template_files").update({ size_bytes: 500, sha256: hash }).eq("id", copy.fileId);
    const row = (await service().from("template_files").select("duplicate_of").eq("id", copy.fileId).single()).data;
    expect(row?.duplicate_of).toBe(first.fileId);
    await other.client.rpc("submit_template", { p_template_id: copy.id });
    await scan(copy.fileId, hash);
    expect(await status(copy.id)).toBe("pending");

    const info = (await other.client.rpc("file_duplicate_info", { p_file_id: copy.fileId })).data?.[0];
    expect(info?.same_creator).toBe(false);
    expect(info?.template_slug).toBeTruthy();
    expect((await creator.client.rpc("file_duplicate_info", { p_file_id: copy.fileId })).data ?? []).toHaveLength(0);
    expect((await anon().rpc("file_duplicate_info", { p_file_id: copy.fileId })).error).not.toBeNull();
    // Readmes are never treated as duplicates.
    const readme = await pendingListing(other.id);
    await service().from("template_files").update({ extension: "txt", original_filename: "readme.txt" }).eq("id", readme.fileId);
    await service().from("template_files").update({ size_bytes: 500, sha256: hash }).eq("id", readme.fileId);
    expect((await service().from("template_files").select("duplicate_of").eq("id", readme.fileId).single()).data?.duplicate_of).toBeNull();
  });

  it("auto-publish makes a listing public only after a clean scan of the stored hash", async () => {
    await service().from("site_settings").update({ auto_publish: true }).eq("id", 1);
    const l = await pendingListing(creator.id);
    await creator.client.rpc("submit_template", { p_template_id: l.id });
    const status = async () => (await service().from("templates").select("publication_status").eq("id", l.id).single()).data?.publication_status;
    expect(await status()).toBe("pending");
    // Mismatched hash: stays pending.
    await moderator.client.rpc("record_scan_result", {
      p_file_id: l.fileId, p_result: "clean", p_scanner_name: "ClamAV", p_scanner_version: "1", p_signature_version: "d", p_scanned_sha256: sha(),
    });
    expect(await status()).toBe("pending");
    await moderator.client.rpc("record_scan_result", {
      p_file_id: l.fileId, p_result: "clean", p_scanner_name: "ClamAV", p_scanner_version: "1", p_signature_version: "d", p_scanned_sha256: l.hash,
    });
    expect(await status()).toBe("approved");
    expect((await anon().rpc("file_download_state", { p_file_id: l.fileId })).data).toBe("ok");
    // Metadata edits re-publish automatically because the files are unchanged and clean.
    await creator.client.from("templates").update({ description: "edited" }).eq("id", l.id);
    expect(await status()).toBe("approved");
    // Only admins can switch the mode.
    expect((await moderator.client.rpc("admin_set_auto_publish", { p_enabled: false })).error).not.toBeNull();
    expect((await creator.client.from("site_settings").update({ auto_publish: false }).eq("id", 1)).error).not.toBeNull();
    expect((await service().from("site_settings").select("auto_publish").single()).data?.auto_publish).toBe(true);
  });

  it("follows: only your own, counted, no self-follow", async () => {
    const before = (await service().from("profiles").select("follower_count").eq("id", creator.id).single()).data!.follower_count;
    expect((await other.client.from("follows").insert({ follower_id: other.id, creator_id: creator.id })).error).toBeNull();
    expect((await other.client.from("follows").insert({ follower_id: creator.id, creator_id: other.id })).error).not.toBeNull();
    expect((await creator.client.from("follows").insert({ follower_id: creator.id, creator_id: creator.id })).error).not.toBeNull();
    expect((await service().from("profiles").select("follower_count").eq("id", creator.id).single()).data!.follower_count).toBe(before + 1);
    expect((await creator.client.from("profiles").update({ follower_count: 999 } as never).eq("id", creator.id)).error).not.toBeNull();
    expect((await creator.client.from("follows").select("*").eq("creator_id", creator.id)).data).toEqual([]);
    expect((await anon().from("follows").select("*")).data).toEqual([]);
    // Logged-out visitors can still browse every sort (the homepage uses trending).
    for (const sort of ["trending", "recent", "views", "likes", "downloads", "rating", "relevance"]) {
      expect((await anon().rpc("search_templates", { p_sort: sort, p_limit: 2 })).error, sort).toBeNull();
    }
    await other.client.from("follows").delete().eq("creator_id", creator.id);
    expect((await service().from("profiles").select("follower_count").eq("id", creator.id).single()).data!.follower_count).toBe(before);
  });

  it("search pages are consistent, counted, and skip suspended creators", async () => {
    const page = (offset: number, limit: number, sort = "recent") =>
      anon().rpc("search_templates", { p_sort: sort, p_limit: limit, p_offset: offset });
    for (const sort of ["recent", "trending", "rating"]) {
      const all = await page(0, 6, sort);
      const [a, b] = await Promise.all([page(0, 3, sort), page(3, 3, sort)]);
      expect(all.error).toBeNull();
      expect([...a.data!, ...b.data!].map((r) => r.id), sort).toEqual(all.data!.map((r) => r.id));
      const totals = new Set([...all.data!, ...a.data!, ...b.data!].map((r) => r.total_count));
      expect(totals.size, sort).toBeLessThanOrEqual(1);
    }
    const { data: rows } = await page(0, 60);
    if (rows?.length) {
      const { data: creators } = await service()
        .from("profiles")
        .select("username, is_banned")
        .in("username", [...new Set(rows.map((r) => r.creator_username))]);
      expect(creators!.some((c) => c.is_banned)).toBe(false);
      expect(rows.every((r) => !!r.creator_username)).toBe(true);
      expect(Number(rows[0].total_count)).toBeGreaterThanOrEqual(rows.length);
    }
    // Past the end: no rows, no error.
    const past = await page(100000, 5);
    expect(past.error).toBeNull();
    expect(past.data).toEqual([]);
  });

  it("comments: public listings only, own edits, staff moderation, counted", async () => {
    const l = await pendingListing(creator.id);
    expect((await other.client.from("comments").insert({ template_id: l.id, author_id: other.id, body: "too early" })).error).not.toBeNull();
    await creator.client.rpc("submit_template", { p_template_id: l.id });
    await moderator.client.rpc("record_scan_result", {
      p_file_id: l.fileId, p_result: "clean", p_scanner_name: "ClamAV", p_scanner_version: "1", p_signature_version: "d", p_scanned_sha256: l.hash,
    });
    const { data: c, error } = await other.client.from("comments").insert({ template_id: l.id, author_id: other.id, body: "  Nice layout  " }).select("id, body").single();
    expect(error).toBeNull();
    expect(c?.body).toBe("Nice layout");
    expect((await other.client.from("comments").insert({ template_id: l.id, author_id: creator.id, body: "impersonation" })).error).not.toBeNull();
    const reply = await creator.client.from("comments").insert({ template_id: l.id, author_id: creator.id, parent_id: c!.id, body: "Thanks" }).select("id").single();
    expect(reply.error).toBeNull();
    expect((await anon().from("comments").select("id").eq("template_id", l.id)).data).toHaveLength(2);
    await creator.client.from("comments").update({ body: "hijack" }).eq("id", c!.id);
    expect((await service().from("comments").select("body").eq("id", c!.id).single()).data?.body).toBe("Nice layout");
    expect((await service().from("templates").select("comment_count").eq("id", l.id).single()).data?.comment_count).toBe(2);
    expect((await moderator.client.from("comments").delete({ count: "exact" }).eq("id", reply.data!.id)).count).toBe(1);
    expect((await service().from("templates").select("comment_count").eq("id", l.id).single()).data?.comment_count).toBe(1);
  });

  it("views are counted once per visitor per day and only by the server", async () => {
    const l = await pendingListing(creator.id);
    await creator.client.rpc("submit_template", { p_template_id: l.id });
    await moderator.client.rpc("record_scan_result", {
      p_file_id: l.fileId, p_result: "clean", p_scanner_name: "ClamAV", p_scanner_version: "1", p_signature_version: "d", p_scanned_sha256: l.hash,
    });
    expect((await other.client.rpc("register_view", { p_template_id: l.id, p_actor_hash: "x".repeat(32) })).error).not.toBeNull();
    expect((await service().rpc("register_view", { p_template_id: l.id, p_actor_hash: "a".repeat(32) })).data).toBe(true);
    expect((await service().rpc("register_view", { p_template_id: l.id, p_actor_hash: "a".repeat(32) })).data).toBe(false);
    expect((await service().rpc("register_view", { p_template_id: l.id, p_actor_hash: "b".repeat(32) })).data).toBe(true);
    expect((await service().from("templates").select("view_count").eq("id", l.id).single()).data?.view_count).toBe(2);
  });

  it("flagged files block approval, auto-publish and downloads", async () => {
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
    await service().from("site_settings").update({ auto_publish: false }).eq("id", 1);
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
    await service().from("site_settings").update({ auto_publish: true }).eq("id", 1);
  });

  it("download counts are de-duplicated and cannot be called by clients", async () => {
    const l = await pendingListing(creator.id);
    expect((await other.client.rpc("register_download", { p_file_id: l.fileId, p_actor_hash: "x", p_user_id: other.id })).error).not.toBeNull();
    expect((await other.client.from("templates").update({ download_count: 1000 } as never).eq("id", l.id)).error).not.toBeNull();
  });

  it("private data stays private", async () => {
    for (const table of ["reports", "moderation_events", "download_events", "scan_records", "rate_limits", "template_views"] as const) {
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

  it("a listing a moderator rejected never auto-publishes again until a moderator approves it", async () => {
    await service().from("site_settings").update({ auto_publish: true }).eq("id", 1);
    const l = await pendingListing(creator.id);
    const row = async () =>
      (await service().from("templates").select("publication_status, requires_review").eq("id", l.id).single()).data;
    await creator.client.rpc("submit_template", { p_template_id: l.id });
    await moderator.client.rpc("record_scan_result", {
      p_file_id: l.fileId, p_result: "clean", p_scanner_name: "ClamAV", p_scanner_version: "1", p_signature_version: "d", p_scanned_sha256: l.hash,
    });
    expect(await row()).toMatchObject({ publication_status: "approved", requires_review: false });

    expect((await moderator.client.rpc("moderate_template", { p_template_id: l.id, p_action: "reject", p_reason: "Not a real template" })).error).toBeNull();
    expect(await row()).toMatchObject({ publication_status: "rejected", requires_review: true });

    // The creator cannot clear the flag, through the table or any other way.
    expect((await creator.client.from("templates").update({ requires_review: false } as never).eq("id", l.id)).error).not.toBeNull();
    expect((await creator.client.from("templates").update({ title: "Renamed listing", requires_review: false } as never).eq("id", l.id)).error).not.toBeNull();
    expect((await row())?.requires_review).toBe(true);

    // Resubmitting with clean files waits for a moderator instead of going live.
    expect((await creator.client.rpc("submit_template", { p_template_id: l.id })).error).toBeNull();
    expect(await row()).toMatchObject({ publication_status: "pending", requires_review: true });
    expect((await anon().from("templates").select("id").eq("id", l.id)).data).toEqual([]);

    // A moderator approval clears the flag; later edits can auto-publish again.
    expect((await moderator.client.rpc("moderate_template", { p_template_id: l.id, p_action: "approve" })).error).toBeNull();
    expect(await row()).toMatchObject({ publication_status: "approved", requires_review: false });
    await creator.client.from("templates").update({ description: "edited after approval" }).eq("id", l.id);
    expect((await row())?.publication_status).toBe("approved");

    // Removal sets the flag too.
    await moderator.client.rpc("moderate_template", { p_template_id: l.id, p_action: "remove", p_reason: "Copyright claim" });
    expect(await row()).toMatchObject({ publication_status: "removed", requires_review: true });
  });

  it("the scanner account only reads and records scans of files waiting for one", async () => {
    const scanner = await user();
    await service().from("profiles").update({ is_scanner: true } as never).eq("id", scanner.id);
    expect((await scanner.client.rpc("is_scanner")).data).toBe(true);
    expect((await scanner.client.rpc("is_staff")).data).toBe(false);
    // Nobody can make themselves a scanner.
    expect((await other.client.from("profiles").update({ is_scanner: true } as never).eq("id", other.id)).error).not.toBeNull();
    expect((await other.client.rpc("is_scanner")).data).toBe(false);

    const waiting = await pendingListing(creator.id);
    const done = await pendingListing(creator.id);
    await moderator.client.rpc("record_scan_result", {
      p_file_id: done.fileId, p_result: "flagged", p_scanner_name: "ClamAV", p_scanner_version: "1", p_signature_version: "d", p_scanned_sha256: done.hash,
    });
    const keys = Object.fromEntries(
      ((await service().from("template_files").select("id, storage_key").in("id", [waiting.fileId, done.fileId])).data ?? []).map((f) => [f.id, f.storage_key]),
    );
    for (const id of [waiting.fileId, done.fileId]) {
      await service().storage.from("quarantine").upload(keys[id], new Blob(["scan me"]), { contentType: "application/octet-stream" });
    }

    // Listing: only files waiting for a scan, and none of the listings themselves.
    const { data: visible } = await scanner.client.from("template_files").select("id").in("id", [waiting.fileId, done.fileId]);
    expect(visible?.map((f) => f.id)).toEqual([waiting.fileId]);
    expect((await scanner.client.from("templates").select("id").eq("id", waiting.id)).data).toEqual([]);

    // Bytes: only of the waiting file.
    expect((await scanner.client.storage.from("quarantine").download(keys[waiting.fileId])).error).toBeNull();
    expect((await scanner.client.storage.from("quarantine").download(keys[done.fileId])).error).not.toBeNull();

    // Recording: a first result only, never overwriting an existing one, and no moderation.
    expect((await scanner.client.rpc("record_scan_result", {
      p_file_id: done.fileId, p_result: "clean", p_scanner_name: "ClamAV", p_scanner_version: "1", p_signature_version: "d", p_scanned_sha256: done.hash,
    })).error).not.toBeNull();
    const first = await scanner.client.rpc("record_scan_result", {
      p_file_id: waiting.fileId, p_result: "clean", p_scanner_name: "ClamAV", p_scanner_version: "1", p_signature_version: "d", p_scanned_sha256: waiting.hash,
    });
    expect(first.error).toBeNull();
    expect(first.data).toBe("clean");
    expect((await scanner.client.rpc("record_scan_result", {
      p_file_id: waiting.fileId, p_result: "clean", p_scanner_name: "ClamAV", p_scanner_version: "1", p_signature_version: "d", p_scanned_sha256: waiting.hash,
    })).error).not.toBeNull();
    expect((await scanner.client.rpc("moderate_template", { p_template_id: waiting.id, p_action: "approve" })).error).not.toBeNull();
    expect((await scanner.client.storage.from("quarantine").download(keys[waiting.fileId])).error).not.toBeNull();
    await service().storage.from("quarantine").remove(Object.values(keys));
  });

  it("direct API inserts cannot skip the daily listing limit", async () => {
    const maker = await user();
    const insert = () =>
      maker.client.from("templates").insert({
        slug: `cap-${randomBytes(5).toString("hex")}`,
        creator_id: maker.id,
        title: "Daily cap listing",
        platform_id: "quantower",
        category_id: "footprint",
      });
    const cap = (await service().from("site_settings").select("max_daily_submissions").single()).data!.max_daily_submissions;
    const results = await Promise.all(Array.from({ length: cap + 2 }, () => insert()));
    expect(results.filter((r) => r.error === null)).toHaveLength(cap);
    expect((await insert()).error?.message).toMatch(/limit/i);
    // The server's secret key (seed and maintenance scripts) is not limited.
    expect((await service().from("templates").insert({
      slug: `cap-${randomBytes(5).toString("hex")}`, creator_id: maker.id, title: "Seeded listing", platform_id: "quantower", category_id: "footprint",
    })).error).toBeNull();
  });

  it("suspended users cannot favorite and their reviews stop counting", async () => {
    await service().from("site_settings").update({ auto_publish: true }).eq("id", 1);
    const l = await pendingListing(creator.id);
    await creator.client.rpc("submit_template", { p_template_id: l.id });
    await moderator.client.rpc("record_scan_result", {
      p_file_id: l.fileId, p_result: "clean", p_scanner_name: "ClamAV", p_scanner_version: "1", p_signature_version: "d", p_scanned_sha256: l.hash,
    });
    const reviewer = await user();
    expect((await reviewer.client.from("reviews").insert({ template_id: l.id, author_id: reviewer.id, rating: 1 })).error).toBeNull();
    expect((await other.client.from("reviews").insert({ template_id: l.id, author_id: other.id, rating: 5 })).error).toBeNull();
    const rating = async () => (await service().from("templates").select("rating_count, rating_avg").eq("id", l.id).single()).data;
    expect(await rating()).toMatchObject({ rating_count: 2 });

    await moderator.client.rpc("admin_set_banned", { p_user_id: reviewer.id, p_banned: true, p_reason: "spam" });
    expect(await rating()).toMatchObject({ rating_count: 1 });
    expect(Number((await rating())?.rating_avg)).toBe(5);
    expect((await anon().from("reviews").select("id").eq("template_id", l.id)).data).toHaveLength(1);
    expect((await reviewer.client.from("favorites").insert({ user_id: reviewer.id, template_id: l.id })).error).not.toBeNull();

    await moderator.client.rpc("admin_set_banned", { p_user_id: reviewer.id, p_banned: false });
    expect(await rating()).toMatchObject({ rating_count: 2 });
    expect((await reviewer.client.from("favorites").insert({ user_id: reviewer.id, template_id: l.id })).error).toBeNull();
  });

  describe("likes and creator points", () => {
    /** A fresh creator with one approved listing, so points start at zero. */
    async function approvedListing() {
      await service().from("site_settings").update({ auto_publish: true }).eq("id", 1);
      const owner = await user();
      const l = await pendingListing(owner.id);
      await owner.client.rpc("submit_template", { p_template_id: l.id });
      await moderator.client.rpc("record_scan_result", {
        p_file_id: l.fileId, p_result: "clean", p_scanner_name: "ClamAV", p_scanner_version: "1", p_signature_version: "d", p_scanned_sha256: l.hash,
      });
      const status = (await service().from("templates").select("publication_status").eq("id", l.id).single()).data?.publication_status;
      expect(status).toBe("approved");
      return { owner, listing: l };
    }
    const likeCount = async (id: string) => (await service().from("templates").select("like_count").eq("id", id).single()).data!.like_count;
    const points = async (id: string) => (await service().from("profiles").select("points").eq("id", id).single()).data!.points;

    it("like and unlike update the listing count and the creator's points", async () => {
      const { owner, listing } = await approvedListing();
      const fan = await user();
      expect((await other.client.from("likes").insert({ user_id: other.id, template_id: listing.id })).error).toBeNull();
      expect((await fan.client.from("likes").insert({ user_id: fan.id, template_id: listing.id })).error).toBeNull();
      // One like per user and listing.
      expect((await fan.client.from("likes").insert({ user_id: fan.id, template_id: listing.id })).error?.code).toBe("23505");
      expect(await likeCount(listing.id)).toBe(2);
      expect(await points(owner.id)).toBe(2);
      // Counts are public, like rows are private to their owner.
      expect((await anon().from("templates").select("like_count").eq("id", listing.id).single()).data?.like_count).toBe(2);
      expect((await anon().from("profiles").select("points").eq("id", owner.id).single()).data?.points).toBe(2);
      expect((await fan.client.from("likes").select("user_id").eq("template_id", listing.id)).data).toEqual([{ user_id: fan.id }]);
      expect((await owner.client.from("likes").select("user_id").eq("template_id", listing.id)).data).toEqual([]);
      // Nobody can remove someone else's like.
      await owner.client.from("likes").delete().eq("template_id", listing.id);
      expect(await likeCount(listing.id)).toBe(2);
      // Likes appear in search and the "likes" sort works.
      const found = await anon().rpc("search_templates", { p_creator: owner.id, p_sort: "likes" });
      expect(found.error).toBeNull();
      expect(found.data?.[0]).toMatchObject({ id: listing.id, like_count: 2 });

      expect((await fan.client.from("likes").delete({ count: "exact" }).eq("user_id", fan.id).eq("template_id", listing.id)).count).toBe(1);
      expect(await likeCount(listing.id)).toBe(1);
      expect(await points(owner.id)).toBe(1);
    });

    it("no self likes, no likes on listings that are not public, no anonymous likes", async () => {
      const { owner, listing } = await approvedListing();
      expect((await owner.client.from("likes").insert({ user_id: owner.id, template_id: listing.id })).error).not.toBeNull();
      // Liking in someone else's name.
      expect((await other.client.from("likes").insert({ user_id: owner.id, template_id: listing.id })).error).not.toBeNull();
      expect((await anon().from("likes").insert({ user_id: other.id, template_id: listing.id })).error).not.toBeNull();
      expect((await anon().from("likes").select("*")).error).not.toBeNull();
      const pending = await pendingListing(owner.id);
      expect((await other.client.from("likes").insert({ user_id: other.id, template_id: pending.id })).error).not.toBeNull();
      expect(await likeCount(listing.id)).toBe(0);
      expect(await likeCount(pending.id)).toBe(0);
      expect(await points(owner.id)).toBe(0);
    });

    it("clients cannot set like counts or points directly", async () => {
      const { owner, listing } = await approvedListing();
      expect((await owner.client.from("templates").update({ like_count: 999 } as never).eq("id", listing.id)).error).not.toBeNull();
      expect((await owner.client.from("profiles").update({ points: 999 } as never).eq("id", owner.id)).error).not.toBeNull();
      expect((await owner.client.rpc("refresh_points" as never, { p_user_id: owner.id } as never)).error).not.toBeNull();
      expect((await owner.client.rpc("refresh_like_count" as never, { p_template_id: listing.id } as never)).error).not.toBeNull();
      // An allowed profile edit leaves points alone.
      expect((await owner.client.from("profiles").update({ bio: "points test" }).eq("id", owner.id)).error).toBeNull();
      expect(await likeCount(listing.id)).toBe(0);
      expect(await points(owner.id)).toBe(0);
    });

    it("suspended users' likes and removed listings stop counting", async () => {
      const { owner, listing } = await approvedListing();
      const fan = await user();
      await other.client.from("likes").insert({ user_id: other.id, template_id: listing.id });
      await fan.client.from("likes").insert({ user_id: fan.id, template_id: listing.id });
      expect(await points(owner.id)).toBe(2);

      await moderator.client.rpc("admin_set_banned", { p_user_id: fan.id, p_banned: true, p_reason: "spam" });
      expect(await likeCount(listing.id)).toBe(1);
      expect(await points(owner.id)).toBe(1);
      await moderator.client.rpc("admin_set_banned", { p_user_id: fan.id, p_banned: false });
      expect(await likeCount(listing.id)).toBe(2);
      expect(await points(owner.id)).toBe(2);
      await moderator.client.rpc("admin_set_banned", { p_user_id: fan.id, p_banned: true, p_reason: "spam" });
      // A suspended account cannot like.
      const another = await approvedListing();
      expect((await fan.client.from("likes").insert({ user_id: fan.id, template_id: another.listing.id })).error).not.toBeNull();

      // A removed listing gives no points; approving it again restores them.
      expect((await moderator.client.rpc("moderate_template", { p_template_id: listing.id, p_action: "remove", p_reason: "copyright claim" })).error).toBeNull();
      expect(await points(owner.id)).toBe(0);
      expect((await moderator.client.rpc("moderate_template", { p_template_id: listing.id, p_action: "approve" })).error).toBeNull();
      expect(await points(owner.id)).toBe(1);
      // Deleting the listing takes its points with it.
      await service().from("templates").delete().eq("id", listing.id);
      expect(await points(owner.id)).toBe(0);
    });
  });

  it("storage: upload URLs write a key once, quotas use real sizes, orphans are found", async () => {
    const owner = await user();
    const { data: t } = await service()
      .from("templates")
      .insert({ slug: `st-${randomBytes(4).toString("hex")}`, creator_id: owner.id, title: "Storage listing", platform_id: "quantower", category_id: "footprint" })
      .select("id")
      .single();
    const key = `files/${t!.id}/${randomUUID()}.bin`;
    // Declared 10 bytes, uploads 3000.
    await service().from("template_files").insert({
      template_id: t!.id, uploader_id: owner.id, storage_key: key, original_filename: "a.xml", extension: "xml", declared_size_bytes: 10,
    });
    expect((await service().rpc("user_storage_usage", { p_user_id: owner.id })).data).toBe(10);
    const signed = await service().storage.from("quarantine").createSignedUploadUrl(key, { upsert: false });
    const first = await anon().storage.from("quarantine").uploadToSignedUrl(key, signed.data!.token, new Blob(["x".repeat(3000)]), { contentType: "application/octet-stream" });
    expect(first.error).toBeNull();
    expect((await service().rpc("user_storage_usage", { p_user_id: owner.id })).data).toBe(3000);
    // The same URL cannot replace the stored object, even when the client asks to upsert.
    const again = await anon().storage.from("quarantine").uploadToSignedUrl(key, signed.data!.token, new Blob(["y".repeat(10)]), { contentType: "application/octet-stream", upsert: true });
    expect(again.error).not.toBeNull();
    const stored = await service().storage.from("quarantine").download(key);
    expect((await stored.data!.text()).startsWith("x")).toBe(true);

    // Once the record no longer needs the object (failed validation), it is an orphan.
    const orphansOf = async () =>
      ((await service().rpc("storage_orphans", { p_min_age: "0 seconds" })).data ?? []).filter((o) => o.name === key);
    expect(await orphansOf()).toEqual([]);
    await service().from("template_files").update({ validation_status: "failed" }).eq("storage_key", key);
    expect(await orphansOf()).toHaveLength(1);
    // Still counted for its owner until it is deleted.
    expect((await service().rpc("user_storage_usage", { p_user_id: owner.id })).data).toBe(3000);
    await service().storage.from("quarantine").remove([key]);
    expect((await service().rpc("user_storage_usage", { p_user_id: owner.id })).data).toBe(0);

    // Avatar originals have their own 2 MB bucket.
    const avatarKey = `avatars/${owner.id}/${randomUUID()}.bin`;
    const avatarUrl = await service().storage.from("avatar-uploads").createSignedUploadUrl(avatarKey, { upsert: false });
    const big = await anon().storage.from("avatar-uploads").uploadToSignedUrl(avatarKey, avatarUrl.data!.token, new Blob([new Uint8Array(2 * 1024 * 1024 + 1)]), { contentType: "application/octet-stream" });
    expect(big.error).not.toBeNull();
    // Clients have no access to avatar reservations or the cleanup functions.
    expect((await owner.client.from("avatar_uploads").select("id")).error).not.toBeNull();
    expect((await owner.client.rpc("storage_orphans", {})).error).not.toBeNull();
    expect((await owner.client.rpc("cleanup_stale_uploads")).error).not.toBeNull();
  });
});
