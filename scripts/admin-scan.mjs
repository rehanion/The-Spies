#!/usr/bin/env node
// SPIES manual malware-scan helper. Runs on the administrator's own computer.
//
// For every validated file that is waiting for a scan it:
//   1. downloads the quarantined bytes with the signed-in session (staff or
//      scanner storage policy; no secret key is needed or used),
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
// Errors show up as annotations on the GitHub run.
const GH = process.env.GITHUB_ACTIONS ? "::error::" : "";

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
  console.error(GH + "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (public values).");
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
    console.error(GH + `Could not run ${args.clamscan}. Install ClamAV (see docs/MANUAL_SCANNING.md).`);
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
    console.error(GH + "ClamAV reports no signature database. Run `freshclam` first.");
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
// The scheduled GitHub job signs in with a one-time login token (password
// sign-in needs a Turnstile challenge once CAPTCHA is on); people use a password.
const tokenHash = process.env.SPIES_ADMIN_TOKEN_HASH;
const { data: auth, error: authError } = tokenHash
  ? await db.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" })
  : await db.auth.signInWithPassword({
      email: process.env.SPIES_ADMIN_EMAIL || (await ask("Admin email: ")),
      password: process.env.SPIES_ADMIN_PASSWORD || (await ask("Password: ", true)),
    });
if (authError || !auth.user) {
  console.error(GH + `Sign-in failed: ${authError?.message ?? "unknown error"}`);
  process.exit(2);
}
// Staff, or the dedicated scanner account (profiles.is_scanner), which can only
// read files waiting for a scan and record a first result for them.
const [{ data: staff }, { data: scanner }] = await Promise.all([db.rpc("is_staff"), db.rpc("is_scanner")]);
if (!staff && !scanner) {
  console.error(GH + "This account is not the scanner, a moderator or an admin.");
  process.exit(2);
}

const version = clamVersion();
console.log(`Scanner: ${version.engine}, signatures: ${version.signature}`);

const { data: files, error } = await db
  .from("template_files")
  .select("id, storage_key, sha256")
  .eq("is_current", true)
  .eq("validation_status", "passed")
  .eq("scan_status", "pending")
  .order("created_at")
  .limit(Number.parseInt(args.limit, 10) || 50);
if (error) {
  console.error(GH + `Could not list pending files: ${error.message}`);
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
    // Logs show only the file id: GitHub Actions logs of a public repository are public.
    const label = f.id;
    const { data: blob, error: dlError } = await db.storage.from("quarantine").download(f.storage_key);
    if (dlError || !blob) {
      console.log(`! ${label}: download failed (${dlError?.message ?? "no data"})`);
      failures++;
      continue;
    }
    const bytes = Buffer.from(await blob.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== f.sha256) {
      console.log(`! ${label}: downloaded hash differs from the server hash; not recording.`);
      failures++;
      continue;
    }
    const path = join(dir, `${randomUUID()}.bin`);
    writeFileSync(path, bytes, { mode: 0o600 });
    const scannedAt = new Date().toISOString();
    const { result, output } = scan(path);
    rmSync(path, { force: true });
    console.log(`${result === "clean" ? "✓" : result === "flagged" ? "✗" : "!"} ${label}: ${result}`);
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
console.log(`Scanned ${files.length} file(s), ${failures} problem(s).`);
console.log(args["dry-run"] ? "Dry run: nothing recorded." : "Done. Review and approve listings in the admin dashboard.");
process.exit(failures ? 1 : 0);
