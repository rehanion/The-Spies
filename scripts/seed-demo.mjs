#!/usr/bin/env node
// Seeds clearly-marked demo listings so a fresh SPIES install has something to
// browse. Demo content:
//   - belongs to a demo creator account whose profile has is_demo = true,
//   - has is_demo = true on every listing (shown with a "Demo" badge),
//   - has zero downloads, favorites and reviews (no fabricated activity),
//   - has NO downloadable files and no scan results (nothing is claimed),
//   - uses generated placeholder screenshots.
//
// Usage: npm run seed:demo            create demo content (idempotent)
//        npm run seed:demo -- --remove delete all demo content again
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY. Run it from your own
// machine; never put the secret key in a client or public repository.

import { existsSync, readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Image } from "imagescript";

for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.");
  process.exit(2);
}
const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const DEMO_USERNAME = "spies_demo";

async function demoUserId() {
  const { data } = await db.from("profiles").select("id").eq("username", DEMO_USERNAME).maybeSingle();
  return data?.id ?? null;
}

async function removeAll() {
  const id = await demoUserId();
  const { data: templates } = await db.from("templates").select("id").eq("is_demo", true);
  for (const t of templates ?? []) {
    const { data: objects } = await db.storage.from("previews").list(`shots/${t.id}`);
    if (objects?.length) await db.storage.from("previews").remove(objects.map((o) => `shots/${t.id}/${o.name}`));
  }
  await db.from("templates").delete().eq("is_demo", true);
  if (id) await db.auth.admin.deleteUser(id);
  console.log(`Removed ${templates?.length ?? 0} demo listings${id ? " and the demo account" : ""}.`);
}

// Simple candlestick-style placeholder so cards look like trading layouts.
async function screenshot(seed, accent) {
  const w = 1280;
  const h = 720;
  const img = new Image(w, h);
  img.fill(0x0f1317ff);
  for (let y = 60; y < h; y += 60) img.drawBox(0, y, w, 1, 0x1d242cff);
  let price = h / 2;
  let rnd = seed;
  const next = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let x = 40; x < w - 120; x += 18) {
    const open = price;
    price = Math.max(80, Math.min(h - 80, price + (next() - 0.5) * 60));
    const top = Math.min(open, price);
    const height = Math.max(2, Math.abs(open - price));
    const up = price < open;
    img.drawBox(x + 5, top - 10 - next() * 15, 2, height + 25 + next() * 15, 0x5b6672ff);
    img.drawBox(x, top, 12, height, up ? 0x3fa37aff : 0xc2564bff);
  }
  img.drawBox(w - 110, 0, 110, h, 0x151a20ff);
  for (let y = 40; y < h - 40; y += 14) img.drawBox(w - 105, y, 10 + next() * 90, 10, accent);
  img.drawBox(0, 0, w, 36, 0x151a20ff);
  img.drawBox(16, 12, 140, 12, 0xd6a54aff);
  const full = await img.encodeJPEG(88);
  const thumb = await img.clone().resize(640, Image.RESIZE_AUTO).encodeJPEG(80);
  return { full, thumb, width: w, height: h };
}

const LISTINGS = [
  ["ES footprint scalping layout", "sierra-chart", "footprint", "Numbers bars with bid/ask imbalance highlighting for ES 1-minute scalping."],
  ["Composite volume profile workspace", "quantower", "volume-profile", "Weekly composite profile with value-area lines and session splits."],
  ["DOM ladder with heatmap", "quantower", "dom", "Trading DOM with cumulative depth and recent prints column."],
  ["Order-flow analysis pack", "motivewave", "footprint", "Delta, cumulative delta and footprint panes arranged for review."],
  ["Clean swing-trading chartbook", "sierra-chart", "volume-profile", "Daily and 4-hour charts with TPO profile and key levels."],
  ["Multi-timeframe NQ workspace", "motivewave", "dom", "Linked 1m/5m/15m charts with VWAP bands."],
];

async function seed() {
  let id = await demoUserId();
  if (!id) {
    const email = `demo+${randomBytes(4).toString("hex")}@spies.invalid`;
    const { data, error } = await db.auth.admin.createUser({
      email,
      password: randomBytes(24).toString("base64url"),
      email_confirm: true,
      user_metadata: { username: DEMO_USERNAME },
    });
    if (error) throw error;
    id = data.user.id;
  }
  await db.from("profiles").update({ is_demo: true, display_name: "SPIES Demo", bio: "Sample content for development and previews. Not a real community member." }).eq("id", id);

  const { data: categories } = await db.from("categories").select("id");
  const categoryIds = new Set((categories ?? []).map((c) => c.id));
  let created = 0;
  for (const [i, [title, platform, category, summary]] of LISTINGS.entries()) {
    const { data: exists } = await db.from("templates").select("id").eq("is_demo", true).eq("title", title).maybeSingle();
    if (exists) continue;
    const templateId = randomUUID();
    const { error } = await db.from("templates").insert({
      id: templateId,
      slug: `demo-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      creator_id: id,
      title,
      summary,
      description: `${summary}\n\nThis is a DEMO listing created by the seed script. It has no downloadable files.`,
      platform_id: platform,
      category_id: categoryIds.has(category) ? category : [...categoryIds][0],
      tags: ["demo"],
      rights_attested: true,
      is_demo: true,
    });
    if (error) throw error;
    const shotId = randomUUID();
    const shot = await screenshot(i * 7919 + 17, [0x4a7fd6ff, 0xd6a54aff, 0x3fa37aff][i % 3]);
    const publicKey = `shots/${templateId}/${randomUUID()}.jpg`;
    const thumbKey = `shots/${templateId}/${randomUUID()}.jpg`;
    await db.storage.from("previews").upload(publicKey, shot.full, { contentType: "image/jpeg" });
    await db.storage.from("previews").upload(thumbKey, shot.thumb, { contentType: "image/jpeg" });
    await db.from("template_screenshots").insert({
      id: shotId,
      template_id: templateId,
      uploader_id: id,
      original_key: `screenshots/${templateId}/${randomUUID()}.bin`,
      declared_size_bytes: shot.full.length,
    });
    await db
      .from("template_screenshots")
      .update({ status: "ready", public_key: publicKey, thumb_key: thumbKey, width: shot.width, height: shot.height, public_size_bytes: shot.full.length + shot.thumb.length, caption: "Generated placeholder image" })
      .eq("id", shotId);
    await db
      .from("templates")
      .update({ cover_screenshot_id: shotId, publication_status: "approved", approved_at: new Date().toISOString(), submitted_at: new Date().toISOString() })
      .eq("id", templateId);
    created++;
  }
  console.log(`Demo content ready: ${created} new listing(s) by @${DEMO_USERNAME}. Remove with: npm run seed:demo -- --remove`);
}

if (process.argv.includes("--remove")) await removeAll();
else await seed();
