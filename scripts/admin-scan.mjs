#!/usr/bin/env node
// SPIES manual malware-scan helper. Runs on the administrator's own computer.
//
// For every validated file that is waiting for a scan it:
//   1. downloads the quarantined bytes with the admin's own session (staff-only
//      storage policy; no secret key is needed or used),
//   2. computes SHA-256 locally and compares it with the server's hash,
//   3. scans the bytes with the local ClamAV `clamscan`,
//   4. records engine version, signature version, time, hash and the result
//      through record_scan_result (which re-checks the hash server-side).
//
// Downloaded files are written to a private temp directory under a random
// name with a .bin extension, are never opened or executed, and are deleted
// right after scanning.
//
// Usage:
//   SPIES_ADMIN_EMAIL=you@example.com npm run admin:scan -- [--dry-run] [--limit 20]
//       [--clamscan /path/to/clamscan] [--database /path/to/signatures]
// Environment: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
// (public values, read from .env.local if present), SPIES_ADMIN_EMAIL and
// SPIES_ADMIN_PASSWORD (prompted for when missing).

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
loadDotEnv(".env.local");
loadDotEnv(".env");

const { values: args } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    limit: { type: "string", default: "50" },
    clamscan: { type: "string", default: "clamscan" },
    database: { type: "string" },
    help: { type: "boolean", default: false },
  },
});
if (args.help) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
  process.exit(0);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (public values).");
  process.exit(2);
}

async function ask(question, hidden = false) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    const write = rl._writeToOutput?.bind(rl);
    rl._writeToOutput = (s) => (s.includes(question) ? write?.(s) : write?.(""));
  }
  const answer = await rl.question(question);
  rl.close();
  if (hidden) process.stdout.write("\n");
  return answer.trim();
}

function clamArgs(extra) {
  return [...(args.database ? ["--database", args.database] : []), ...extra];
}

function clamVersion() {
  const r = spawnSync(args.clamscan, clamArgs(["--version"]), { encoding: "utf8" });
  if (r.error || r.status !== 0) {
    console.error(`Could not run ${args.clamscan}. Install ClamAV (see docs/MANUAL_SCANNING.md).`);
    process.exit(2);
  }
  // "ClamAV 1.5.4/27801/Mon Oct 19 08:23:01 2026" (engine/daily signature version/date)
  const line = r.stdout.trim();
  const [engine, sigVersion, sigDate] = line.split("/");
  let signature = sigVersion ? `daily ${sigVersion}${sigDate ? ` (${sigDate})` : ""}` : "";
  if (args.database) {
    const db = readFileSync(args.database);
    signature = `custom database ${basename(args.database)} sha256:${createHash("sha256").update(db).digest("hex").slice(0, 16)}`;
  }
  if (!signature) {
    console.error("ClamAV reports no signature database. Run `freshclam` first.");
    process.exit(2);
  }
  return { engine: engine.trim(), signature };
}

function scan(path) {
  const r = spawnSync(args.clamscan, clamArgs(["--no-summary", "--stdout", "--infected", "--scan-archive=yes", path]), {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`.replaceAll(path, "<file>").trim().slice(0, 7900);
  // clamscan exit codes: 0 no virus found, 1 virus found, 2 error.
  if (r.status === 0) return { result: "clean", output: output || "OK" };
  if (r.status === 1) return { result: "flagged", output };
  return { result: "error", output: output || String(r.error ?? `exit ${r.status}`) };
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const email = process.env.SPIES_ADMIN_EMAIL || (await ask("Admin email: "));
const password = process.env.SPIES_ADMIN_PASSWORD || (await ask("Password: ", true));
const { data: auth, error: authError } = await db.auth.signInWithPassword({ email, password });
if (authError || !auth.user) {
  console.error(`Sign-in failed: ${authError?.message ?? "unknown error"}`);
  process.exit(2);
}
const { data: me } = await db.from("profiles").select("role, is_banned").eq("id", auth.user.id).single();
if (!me || me.is_banned || !["admin", "moderator"].includes(me.role)) {
  console.error("This account is not a moderator or admin.");
  process.exit(2);
}

const version = clamVersion();
console.log(`Scanner: ${version.engine}, signatures: ${version.signature}`);

const { data: files, error } = await db
  .from("template_files")
  .select("id, template_id, storage_key, original_filename, sha256, size_bytes")
  .eq("is_current", true)
  .eq("validation_status", "passed")
  .eq("scan_status", "pending")
  .order("created_at")
  .limit(Number.parseInt(args.limit, 10) || 50);
if (error) {
  console.error(`Could not list pending files: ${error.message}`);
  process.exit(2);
}
if (!files.length) {
  console.log("No files are waiting for a scan.");
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), "spies-scan-"));
let failures = 0;
try {
  for (const f of files) {
    const label = `${f.original_filename} (${f.id})`;
    const { data: blob, error: dlError } = await db.storage.from("quarantine").download(f.storage_key);
    if (dlError || !blob) {
      console.log(`! ${label}: download failed (${dlError?.message ?? "no data"})`);
      failures++;
      continue;
    }
    const bytes = Buffer.from(await blob.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== f.sha256) {
      console.log(`! ${label}: downloaded hash ${sha256} differs from server hash ${f.sha256}; not recording.`);
      failures++;
      continue;
    }
    const path = join(dir, `${randomUUID()}.bin`);
    writeFileSync(path, bytes, { mode: 0o600 });
    const scannedAt = new Date().toISOString();
    const { result, output } = scan(path);
    rmSync(path, { force: true });
    console.log(`${result === "clean" ? "✓" : result === "flagged" ? "✗" : "!"} ${label}: ${result} sha256=${sha256}`);
    if (args["dry-run"]) continue;
    const { data: stored, error: rpcError } = await db.rpc("record_scan_result", {
      p_file_id: f.id,
      p_result: result,
      p_scanner_name: "ClamAV",
      p_scanner_version: version.engine,
      p_signature_version: version.signature,
      p_scanned_sha256: sha256,
      p_scanned_at: scannedAt,
      p_notes: "Recorded by scripts/admin-scan.mjs",
      p_raw_output: output,
    });
    if (rpcError) {
      console.log(`  could not record: ${rpcError.message}`);
      failures++;
    } else if (stored !== result) {
      console.log(`  server stored "${stored}" (hash check failed on the server).`);
      failures++;
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
  await db.auth.signOut();
}
console.log(args["dry-run"] ? "Dry run: nothing recorded." : "Done. Review and approve listings in the admin dashboard.");
process.exit(failures ? 1 : 0);
