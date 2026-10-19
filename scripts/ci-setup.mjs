#!/usr/bin/env node
// Prepares the hosted services for a GitHub Actions run. Only two repository
// secrets are needed, SUPABASE_ACCESS_TOKEN and (for deploys) CLOUDFLARE_API_TOKEN;
// everything else is looked up or derived here and exported to later steps
// through $GITHUB_ENV, masked in the logs.
//
//   node scripts/ci-setup.mjs supabase    Supabase URL/keys, derived secrets, scanner login
//   node scripts/ci-setup.mjs cloudflare  account, workers.dev URL, Turnstile widget
//   node scripts/ci-setup.mjs configure   Auth settings, function secrets, scanner account
//   node scripts/ci-setup.mjs scanner-login  one-time login token for the scan job
//
// No step here can enable billing: it only reads keys, creates a Turnstile
// widget (free) and a Supabase "secret" API key, and changes settings.
import { createHmac } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../spies.deploy.json", import.meta.url), "utf8"));
const REF = config.supabaseProjectRef;
const SUPABASE_API = "https://api.supabase.com/v1";
const CF_API = "https://api.cloudflare.com/client/v4";

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}. Add it under Settings → Secrets and variables → Actions.`);
  return v;
}

function exportEnv(name, value, { secret = true } = {}) {
  if (secret) console.log(`::add-mask::${value}`);
  process.env[name] = value;
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`);
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

async function supabaseEnv() {
  let keys = await sb(`/projects/${REF}/api-keys?reveal=true`);
  const publishable = keys.find((k) => k.type === "publishable")?.api_key;
  let secret = keys.find((k) => k.type === "secret" && k.name === "spies_server")?.api_key;
  if (!secret) {
    await sb(`/projects/${REF}/api-keys`, { method: "POST", body: JSON.stringify({ type: "secret", name: "spies_server" }) });
    keys = await sb(`/projects/${REF}/api-keys?reveal=true`);
    secret = keys.find((k) => k.type === "secret" && k.name === "spies_server")?.api_key;
  }
  if (!publishable || !secret?.startsWith("sb_secret_")) throw new Error("Could not read the project's publishable and secret API keys.");
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
  const host = `${config.workerName}.${sub}.workers.dev`;
  exportEnv("NEXT_PUBLIC_SITE_URL", `https://${host}`, { secret: false });

  const widgets = await cf(`/accounts/${account}/challenges/widgets`);
  let widget = widgets.find((w) => w.name === "SPIES");
  if (!widget) {
    widget = await cf(`/accounts/${account}/challenges/widgets`, {
      method: "POST",
      body: JSON.stringify({ name: "SPIES", domains: [host], mode: "managed" }),
    });
  } else {
    widget = await cf(`/accounts/${account}/challenges/widgets/${widget.sitekey}`);
    if (!widget.domains.includes(host)) {
      widget = await cf(`/accounts/${account}/challenges/widgets/${widget.sitekey}`, {
        method: "PUT",
        body: JSON.stringify({ name: "SPIES", domains: [...widget.domains, host], mode: widget.mode }),
      });
    }
  }
  exportEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", widget.sitekey, { secret: false });
  exportEnv("TURNSTILE_SECRET_KEY", widget.secret);
}

const sql = (query) => sb(`/projects/${REF}/database/query`, { method: "POST", body: JSON.stringify({ query }) });

async function configure() {
  const site = need("NEXT_PUBLIC_SITE_URL");
  const template = (name) => readFileSync(new URL(`../supabase/templates/${name}.html`, import.meta.url), "utf8");
  await sb(`/projects/${REF}/config/auth`, {
    method: "PATCH",
    body: JSON.stringify({
      site_url: site,
      uri_allow_list: `${site}/auth/confirm,${site}/**`,
      disable_signup: false,
      // Supabase's built-in email only reaches the project's own team, so until
      // a free SMTP provider is added, accounts are active without confirmation.
      mailer_autoconfirm: !config.emailConfirmation,
      password_min_length: 10,
      password_required_characters: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789",
      security_captcha_enabled: true,
      security_captcha_provider: "turnstile",
      security_captcha_secret: need("TURNSTILE_SECRET_KEY"),
      refresh_token_rotation_enabled: true,
      // Free projects can only customise emails once a custom SMTP provider is set.
      ...(config.emailConfirmation
        ? {
            mailer_subjects_confirmation: "Confirm your SPIES account",
            mailer_templates_confirmation_content: template("confirmation"),
            mailer_subjects_recovery: "Reset your SPIES password",
            mailer_templates_recovery_content: template("recovery"),
          }
        : {}),
    }),
  });
  console.log("Auth settings updated");

  await sb(`/projects/${REF}/secrets`, {
    method: "POST",
    body: JSON.stringify([
      { name: "PROCESSOR_SECRET", value: need("PROCESSOR_SECRET") },
      { name: "SPIES_SERVICE_KEY", value: need("SUPABASE_SECRET_KEY") },
    ]),
  });
  console.log("Edge Function secrets updated");

  // The scanner signs in like a person, as a moderator, so GitHub never holds a key that bypasses RLS.
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
  await sql(`update public.profiles set role = 'moderator', is_banned = false where id = '${id}'`);
  console.log("Scanner account ready");
}

// A one-time login for the scanner account, so the scan job never runs with the secret key.
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
  exportEnv("SPIES_ADMIN_TOKEN_HASH", hash);
}

const steps = { supabase: supabaseEnv, cloudflare: cloudflareEnv, configure, "scanner-login": scannerLogin };
const step = steps[process.argv[2]];
if (!step) {
  console.error(`Usage: ci-setup.mjs ${Object.keys(steps).join("|")}`);
  process.exit(2);
}
await step().catch((e) => {
  console.error(`::error::${e.message}`);
  process.exit(1);
});
