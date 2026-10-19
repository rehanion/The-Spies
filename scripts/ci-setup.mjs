#!/usr/bin/env node
// Prepares the hosted services for a GitHub Actions run. Only two repository
// secrets are needed, SUPABASE_ACCESS_TOKEN and (for deploys) CLOUDFLARE_API_TOKEN;
// everything else is looked up or derived here. Public values are exported to
// later steps through $GITHUB_ENV. Secret values are never exported: each step
// that needs one derives it again in its own process, so build tools and
// dependencies in other steps never see them.
//
//   node scripts/ci-setup.mjs supabase        Supabase URL/keys and derived secrets
//   node scripts/ci-setup.mjs cloudflare      account, workers.dev URL, Turnstile widget
//   node scripts/ci-setup.mjs configure       Auth settings, function secrets, scanner account
//   node scripts/ci-setup.mjs dns             add DNS records listed in spies.deploy.json
//   node scripts/ci-setup.mjs worker-secrets  write the Worker secrets to $WORKER_SECRETS_FILE (mode 600)
//   node scripts/ci-setup.mjs scanner-login   one-time scanner login token, as a step output only
//   node scripts/ci-setup.mjs pending         count files waiting for a scan
//   node scripts/ci-setup.mjs cleanup         delete stale upload reservations and unused stored objects
//   node scripts/ci-setup.mjs probe           check the Edge Function answers and accepts the secret
//
// This script uses only Node.js built-ins, so it runs before any dependency
// is installed.
// No step here can enable billing: it only reads keys, creates a Turnstile
// widget (free) and a Supabase "secret" API key, and changes settings.
import { createHmac } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../spies.deploy.json", import.meta.url), "utf8"));
const REF = config.supabaseProjectRef;
const SUPABASE_API = "https://api.supabase.com/v1";
const CF_API = "https://api.cloudflare.com/client/v4";

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}. Add it under Settings → Secrets and variables → Actions.`);
  return v;
}

// Secrets stay in this process; only public values go to later steps.
function exportEnv(name, value, { secret = true } = {}) {
  if (secret) console.log(`::add-mask::${value}`);
  process.env[name] = value;
  if (!secret && process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`);
}

async function call(base, token, path, init = {}) {
  const res = await fetch(base + path, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const sb = (path, init) => call(SUPABASE_API, need("SUPABASE_ACCESS_TOKEN"), path, init);
const cf = async (path, init) => (await call(CF_API, need("CLOUDFLARE_API_TOKEN"), path, init)).result;

// Stable per-project values derived from the Supabase secret key, so the app,
// the Edge Function and the scanner agree without storing extra secrets.
const derive = (label) => createHmac("sha256", process.env.SUPABASE_SECRET_KEY).update(`spies:${label}`).digest("hex");

async function supabaseKeys() {
  let keys = await sb(`/projects/${REF}/api-keys?reveal=true`);
  const publishable = keys.find((k) => k.type === "publishable")?.api_key;
  let secret = keys.find((k) => k.type === "secret" && k.name === "spies_server")?.api_key;
  if (!secret) {
    await sb(`/projects/${REF}/api-keys`, { method: "POST", body: JSON.stringify({ type: "secret", name: "spies_server" }) });
    keys = await sb(`/projects/${REF}/api-keys?reveal=true`);
    secret = keys.find((k) => k.type === "secret" && k.name === "spies_server")?.api_key;
  }
  if (!publishable || !secret?.startsWith("sb_secret_")) throw new Error("Could not read the project's publishable and secret API keys.");
  return { publishable, secret };
}

async function supabaseEnv() {
  const { publishable, secret } = await supabaseKeys();
  exportEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${REF}.supabase.co`, { secret: false });
  exportEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", publishable, { secret: false });
  exportEnv("SUPABASE_SECRET_KEY", secret);
  exportEnv("PROCESSOR_SECRET", derive("processor"));
  exportEnv("ACTOR_HASH_SALT", derive("actor-hash"));
  exportEnv("SPIES_ADMIN_EMAIL", config.scannerEmail, { secret: false });
  exportEnv("SPIES_ADMIN_PASSWORD", derive("scanner"));
}

async function cloudflareEnv() {
  // Tokens without "Account Settings: Read" cannot list accounts, so the ID can be pinned in spies.deploy.json.
  let account = config.cloudflareAccountId;
  if (!account) {
    const accounts = await cf("/accounts");
    if (accounts.length !== 1) throw new Error(`Set cloudflareAccountId in spies.deploy.json (the token sees ${accounts.length} accounts).`);
    account = accounts[0].id;
  }
  exportEnv("CLOUDFLARE_ACCOUNT_ID", account, { secret: false });

  // Report what the token is allowed to do, so a permission problem is obvious in the log.
  for (const path of ["/user/tokens/verify", `/accounts/${account}/tokens/verify`]) {
    try {
      console.log(`::notice::Token check ${path}: ${(await cf(path))?.status}`);
    } catch (e) {
      console.log(`::notice::Token check ${path}: ${e.message}`);
    }
  }
  let sub = null;
  try {
    sub = (await cf(`/accounts/${account}/workers/subdomain`))?.subdomain ?? null;
  } catch (e) {
    console.log(`::notice::No workers.dev subdomain yet (${e.message})`);
  }
  if (!sub) {
    sub = `spies-${account.slice(0, 6)}`;
    await cf(`/accounts/${account}/workers/subdomain`, { method: "PUT", body: JSON.stringify({ subdomain: sub }) });
  }
  const devHost = `${config.workerName}.${sub}.workers.dev`;
  // A custom domain in spies.deploy.json becomes the main address; workers.dev redirects to it.
  const host = config.customDomain || devHost;
  const hosts = [...new Set([host, devHost])];
  exportEnv("NEXT_PUBLIC_SITE_URL", `https://${host}`, { secret: false });

  const widgets = await cf(`/accounts/${account}/challenges/widgets`);
  let widget = widgets.find((w) => w.name === "SPIES");
  if (!widget) {
    widget = await cf(`/accounts/${account}/challenges/widgets`, {
      method: "POST",
      body: JSON.stringify({ name: "SPIES", domains: hosts, mode: "managed" }),
    });
  } else {
    widget = await cf(`/accounts/${account}/challenges/widgets/${widget.sitekey}`);
    if (hosts.some((h) => !widget.domains.includes(h))) {
      widget = await cf(`/accounts/${account}/challenges/widgets/${widget.sitekey}`, {
        method: "PUT",
        body: JSON.stringify({ name: "SPIES", domains: [...new Set([...widget.domains, ...hosts])], mode: widget.mode }),
      });
    }
  }
  exportEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", widget.sitekey, { secret: false });
  exportEnv("TURNSTILE_SECRET_KEY", widget.secret);
}

// DNS records listed in spies.deploy.json "dns" (for example the ones Brevo asks
// for), created in the Cloudflare zone "dnsZone" if missing. Needs the token
// permission Zone DNS Edit for that zone. Never deletes or changes other records.
async function dns() {
  const records = config.dns ?? [];
  if (!records.length || !config.dnsZone) return console.log("No DNS records to add");
  const zones = await cf(`/zones?name=${encodeURIComponent(config.dnsZone)}`);
  if (!zones?.length) throw new Error(`The token cannot see the Cloudflare zone ${config.dnsZone}. Give it Zone DNS Edit for that zone.`);
  const zone = zones[0].id;
  const existing = await cf(`/zones/${zone}/dns_records?per_page=500`);
  const fqdn = (name) => (name === "@" || name === config.dnsZone ? config.dnsZone : name.endsWith(`.${config.dnsZone}`) ? name : `${name}.${config.dnsZone}`);
  const norm = (v) => String(v).replace(/^"|"$/g, "").replace(/\.$/, "").toLowerCase();
  let added = 0;
  for (const r of records) {
    const name = fqdn(r.name);
    const type = r.type.toUpperCase();
    const content = String(r.content).replace(/^"|"$/g, "");
    if (existing.some((e) => e.type === type && e.name === name && norm(e.content) === norm(content))) continue;
    await cf(`/zones/${zone}/dns_records`, {
      method: "POST",
      body: JSON.stringify({ type, name, content, ttl: 1, proxied: false, ...(r.priority != null ? { priority: r.priority } : {}) }),
    });
    added++;
  }
  console.log(`::notice::DNS: ${added} record(s) added, ${records.length - added} already there`);
}

const sql = (query) => sb(`/projects/${REF}/database/query`, { method: "POST", body: JSON.stringify({ query }) });

// Free SMTP (for example Brevo) from spies.deploy.json "smtp" plus the SMTP_PASSWORD
// repository secret. Without both, Supabase's built-in mailer is used and
// accounts are active without confirmation.
function smtpSettings() {
  const smtp = config.smtp;
  const password = process.env.SMTP_PASSWORD;
  if (!smtp?.host || !password) {
    if (smtp?.host) console.log("::notice::smtp is set in spies.deploy.json but the SMTP_PASSWORD secret is missing, so emails stay off.");
    return null;
  }
  console.log(`::add-mask::${password}`);
  return {
    smtp_host: smtp.host,
    smtp_port: String(smtp.port ?? 587),
    smtp_user: smtp.user,
    smtp_pass: password,
    smtp_admin_email: smtp.senderEmail,
    smtp_sender_name: smtp.senderName ?? "SPIES",
    // Brevo's free plan sends 300 emails a day.
    rate_limit_email_sent: smtp.perHour ?? 30,
  };
}

async function configure() {
  const site = need("NEXT_PUBLIC_SITE_URL");
  const smtp = smtpSettings();
  const emails = Boolean(smtp);
  const template = (name) => readFileSync(new URL(`../supabase/templates/${name}.html`, import.meta.url), "utf8");
  await sb(`/projects/${REF}/config/auth`, {
    method: "PATCH",
    body: JSON.stringify({
      site_url: site,
      uri_allow_list: `${site}/auth/confirm,${site}/**`,
      disable_signup: false,
      // Supabase's built-in email only reaches the project's own team, so until
      // a free SMTP provider is added, accounts are active without confirmation.
      mailer_autoconfirm: !emails,
      password_min_length: 10,
      password_required_characters: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789",
      security_captcha_enabled: true,
      security_captcha_provider: "turnstile",
      security_captcha_secret: need("TURNSTILE_SECRET_KEY"),
      refresh_token_rotation_enabled: true,
      // Free projects can only customise emails once a custom SMTP provider is set.
      ...(emails
        ? {
            ...smtp,
            mailer_subjects_confirmation: "Confirm your SPIES account",
            mailer_templates_confirmation_content: template("confirmation"),
            mailer_subjects_recovery: "Reset your SPIES password",
            mailer_templates_recovery_content: template("recovery"),
          }
        : {}),
    }),
  });
  console.log(`Auth settings updated (emails ${emails ? "on" : "off"})`);

  await sb(`/projects/${REF}/secrets`, {
    method: "POST",
    body: JSON.stringify([
      { name: "PROCESSOR_SECRET", value: need("PROCESSOR_SECRET") },
      { name: "SPIES_SERVICE_KEY", value: need("SUPABASE_SECRET_KEY") },
      // Optional repository secret: lets each upload start the virus scan at once.
      ...(process.env.SCAN_DISPATCH_TOKEN
        ? [
            { name: "SCAN_DISPATCH_TOKEN", value: process.env.SCAN_DISPATCH_TOKEN },
            { name: "SCAN_REPOSITORY", value: need("GITHUB_REPOSITORY") },
          ]
        : []),
    ]),
  });
  console.log(`::notice::Edge Function secrets updated (instant scans ${process.env.SCAN_DISPATCH_TOKEN ? "on" : "off"})`);

  // The scanner signs in like a person, so the scan job never holds a key that bypasses RLS.
  const url = need("NEXT_PUBLIC_SUPABASE_URL");
  const key = need("SUPABASE_SECRET_KEY");
  const admin = (path, init) => call(url, key, `/auth/v1/admin${path}`, { ...init, headers: { apikey: key } });
  const email = config.scannerEmail;
  const password = need("SPIES_ADMIN_PASSWORD");
  const found = await sql(`select id from auth.users where email = '${email.replace(/'/g, "''")}'`);
  let id = found[0]?.id;
  if (id) await admin(`/users/${id}`, { method: "PUT", body: JSON.stringify({ password, ban_duration: "none" }) });
  else id = (await admin("/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { username: "spies_scanner" } }) })).id;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Unexpected scanner user id");
  // Least privilege: not staff, only the scanner flag (read waiting files, record a first scan result).
  await sql(`update public.profiles set role = 'user', is_scanner = true, is_banned = false where id = '${id}'`);
  console.log("Scanner account ready");
}

// The Worker's runtime secrets, written to a private file for `wrangler deploy --secrets-file`.
async function workerSecrets() {
  const file = need("WORKER_SECRETS_FILE");
  const keys = ["SUPABASE_SECRET_KEY", "PROCESSOR_SECRET", "ACTOR_HASH_SALT", "TURNSTILE_SECRET_KEY"];
  writeFileSync(file, JSON.stringify(Object.fromEntries(keys.map((k) => [k, need(k)]))), { mode: 0o600 });
  console.log("Worker secrets file written");
}

// A one-time login for the scanner account, so the scan job never runs with
// the secret key or the access token. It is handed only to the scan step, as
// a masked step output (never through $GITHUB_ENV).
async function scannerLogin() {
  const url = need("NEXT_PUBLIC_SUPABASE_URL");
  const key = need("SUPABASE_SECRET_KEY");
  const link = await call(url, key, "/auth/v1/admin/generate_link", {
    method: "POST",
    headers: { apikey: key },
    body: JSON.stringify({ type: "magiclink", email: config.scannerEmail }),
  });
  const hash = link.hashed_token ?? link.properties?.hashed_token;
  if (!hash) throw new Error("Could not create a scanner login token.");
  console.log(`::add-mask::${hash}`);
  if (!process.env.GITHUB_OUTPUT) throw new Error("scanner-login only runs inside GitHub Actions.");
  appendFileSync(process.env.GITHUB_OUTPUT, `token_hash=${hash}\n`);
}

// How many files wait for a scan, so the frequent scan job can stop early when there are none.
async function pending() {
  const rows = await sql(
    "select count(*)::int as n from public.template_files where is_current and validation_status = 'passed' and scan_status = 'pending'",
  );
  const n = rows[0]?.n ?? 0;
  console.log(`${n} file(s) waiting for a scan`);
  exportEnv("SPIES_PENDING", String(n), { secret: false });
}

// Removes upload reservations that never completed and stored objects that no
// record needs (for example a re-upload to a key that was already processed).
// Logs only counts: Actions logs of a public repository are public.
async function cleanup() {
  const [stale] = await sql("select files, screenshots, avatars from public.cleanup_stale_uploads()");
  const orphans = await sql("select bucket_id, name from public.storage_orphans()");
  console.log(`Removed ${stale?.files ?? 0} file, ${stale?.screenshots ?? 0} screenshot and ${stale?.avatars ?? 0} avatar reservation(s)`);
  if (!orphans.length) {
    console.log("No unused stored objects");
    return;
  }
  // Objects must be deleted through the Storage API, which needs the secret key.
  // It is looked up here and never leaves this process.
  const { secret } = await supabaseKeys();
  console.log(`::add-mask::${secret}`);
  const url = `https://${REF}.supabase.co`;
  const byBucket = new Map();
  for (const o of orphans) byBucket.set(o.bucket_id, [...(byBucket.get(o.bucket_id) ?? []), o.name]);
  let removed = 0;
  for (const [bucket, names] of byBucket) {
    for (let i = 0; i < names.length; i += 100) {
      const batch = names.slice(i, i + 100);
      await call(url, secret, `/storage/v1/object/${encodeURIComponent(bucket)}`, {
        method: "DELETE",
        headers: { apikey: secret },
        body: JSON.stringify({ prefixes: batch }),
      });
      removed += batch.length;
    }
  }
  console.log(`Removed ${removed} unused stored object(s)`);
}

// The Edge Function answers a request with no kind with HTTP 400 once the secret matches.
async function probe() {
  const res = await fetch(`${need("NEXT_PUBLIC_SUPABASE_URL")}/functions/v1/process-upload`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-processor-secret": need("PROCESSOR_SECRET") },
    body: JSON.stringify({ kind: "health" }),
  });
  const text = (await res.text()).slice(0, 200);
  console.log(`::notice::Upload processor: HTTP ${res.status} ${text}`);
  if (res.status !== 400) throw new Error(`Upload processor check failed (HTTP ${res.status})`);
}

const steps = {
  supabase: supabaseEnv,
  cloudflare: cloudflareEnv,
  configure,
  dns,
  "worker-secrets": workerSecrets,
  "scanner-login": scannerLogin,
  pending,
  cleanup,
  probe,
};
// Several steps can run in one call (later steps see earlier exports).
const names = process.argv.slice(2);
if (!names.length || names.some((n) => !steps[n])) {
  console.error(`Usage: ci-setup.mjs <${Object.keys(steps).join("|")}>...`);
  process.exit(2);
}
for (const name of names) {
  await steps[name]().catch((e) => {
    console.error(`::error::${e.message}`);
    process.exit(1);
  });
}
