# SPIES

A free community library of trading-platform templates. Traders share MotiveWave, Sierra Chart and Quantower
layouts with screenshots; every file is quarantined, structurally validated and scanned with ClamAV before anyone can
download it. Listings go live automatically once the scan passes (admins can switch to manual approval), and
moderators remove anything reported. The site is laid out like a video community: a trending/new home feed,
creator channels you can follow, a Following feed, views, comments with replies, ratings and saves.

Runs entirely on free tiers: **Next.js on Cloudflare Workers (Free)**, **Supabase (Free)** for Postgres, Auth,
Storage and one Edge Function, and **Cloudflare Turnstile (Free)**. No ads, payments, paid APIs or billable
bindings.

- [Architecture](#architecture)
- [Local development](#local-development)
- [Testing](#testing)
- [Deploying for free](#deploying-for-free)
- [First admin](#creating-the-first-admin)
- [Moderation and scanning](#moderation-and-scanning)
- [Free-tier limits](#free-tier-limits-checked-2026-10-19)
- [Security model](#security-model)
- [Adding a platform](#adding-a-platform)
- [Manual tasks remaining](#manual-tasks-remaining)

## Architecture

```
Browser ──► Cloudflare Worker (Next.js 16 via @opennextjs/cloudflare)
   │            │  pages, server actions, /api routes, CSP + session middleware
   │            ├──► Supabase Postgres (RLS on every table, workflow functions)
   │            └──► Supabase Edge Function process-upload (shared secret)
   │                    hashes, validates, inspects ZIPs, re-encodes images
   └── direct PUT (signed upload URL) ──► Supabase Storage
                                           quarantine  (private)  template files, raw uploads
                                           previews    (public)   re-encoded JPEG screenshots/avatars
Admin's computer ── npm run admin:scan ──► downloads quarantined bytes, runs ClamAV, records result
```

Why the Edge Function: Workers Free allows **10 ms CPU** per request, too little for hashing a 20 MB file,
inflating ZIPs or decoding images. Supabase Edge Functions allow 2 s CPU / 256 MB on Free. The function reads
the object key and platform from the database row, never from the request, and never executes content.

Upload lifecycle:

1. **Reserve** `POST /api/uploads`: checks login, ban, rate limit, extension allowlist, size and storage quotas;
   creates a `pending` row with a random key `files/<template>/<uuid>.bin` and returns a 2-hour signed upload URL
   that cannot overwrite an existing object.
2. **Upload** straight from the browser to the private `quarantine` bucket (bucket allows only
   `application/octet-stream`, 20 MB).
3. **Process** `POST /api/uploads/:id/complete` → Edge Function: server-side SHA-256, magic-byte sniffing
   (executables, scripts, OLE, other archives rejected whatever the name), JSON/XML checks (no DOCTYPE/ENTITY),
   ZIP inspection (entry allowlist, traversal, symlinks, encryption, ZIP64, nesting, ratio/total-size bombs,
   header/CRC consistency). Failing objects are deleted. Screenshots are decoded and re-encoded to JPEG (full +
   thumbnail) into `previews`; originals are deleted. SVG/HTML are never served.
4. **Submit** → `pending` review. Requires rights attestation, ≥1 ready screenshot and only passed files.
5. **Scan** by an admin with ClamAV ([docs/MANUAL_SCANNING.md](docs/MANUAL_SCANNING.md)). The scanned SHA-256
   must equal the stored hash or the result is stored as `error`.
6. **Approve** (`moderate_template`) only when every current file is `passed` + `clean` with a matching hash;
   the approved hash is pinned.
7. **Download** `GET /api/download/:fileId`: `file_download_state()` re-checks approval, creator status, current
   version, validation, clean scan and `sha256 = scanned_sha256 = approved_sha256`; then counts the download
   (once per user/IP per file per 24 h) and redirects to a **60-second** signed URL with a safe filename.

Replacing a file, adding a screenshot or editing an approved listing sends it back to `pending`. A changed hash
resets the scan.

Code map:

| Path | What |
|---|---|
| `src/app` | Pages, server actions, route handlers (`/api/uploads`, `/api/download`, `/api/account/avatar`, `/api/admin`) |
| `src/middleware.ts` | Per-request CSP nonce, security headers, Supabase session refresh |
| `src/lib` | Auth (`getClaims` + role from `profiles`), Turnstile, rate limits, storage adapter, typed DB access |
| `supabase/migrations` | Schema, triggers, workflow functions, RLS, buckets and storage policies |
| `supabase/functions/process-upload` | Edge Function entry (Deno) |
| `supabase/functions/_shared` | Validation code shared by the function, the web app and the tests |
| `scripts/admin-scan.mjs` | Admin ClamAV helper |
| `scripts/seed-demo.mjs` | Clearly-marked demo content |
| `tests/unit`, `tests/integration`, `e2e` | Vitest unit, database/RLS integration, Playwright end-to-end |

## Local development

Requirements: Node 22+, Docker (for the local Supabase stack).

```bash
npm install
npx supabase start               # Postgres, Auth, Storage, Mailpit, Edge Runtime
cp .env.example .env.local       # then fill in the values printed by `npx supabase status`
cp supabase/functions/.env.example supabase/functions/.env
```

For local use set in `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_KEY from supabase status>
SUPABASE_SECRET_KEY=<SECRET_KEY from supabase status>
PROCESSOR_SECRET=<openssl rand -hex 32>        # same value in supabase/functions/.env
ACTOR_HASH_SALT=<openssl rand -hex 32>
TURNSTILE_DISABLED=true                        # or use the Turnstile test keys
```

Then:

```bash
npx supabase db reset            # applies migrations
npm run functions:serve          # in a second terminal
npm run dev                      # http://localhost:3000
npm run seed:demo                # optional demo listings (remove with -- --remove)
```

Confirmation and reset emails land in Mailpit at http://127.0.0.1:54324.

If your network intercepts TLS, the Edge Runtime may fail to download npm packages ("UnknownIssuer"). Add your
proxy CA to the function env (`DENO_CERT=/path/to/ca.pem`) or run behind a network without interception.

## Testing

```bash
npm run lint
npm run typecheck
npm test                         # unit tests (validation, ZIP attacks, images, filenames, redirects, gate)
npm run test:integration         # RLS / permissions / workflow tests against the local stack
npm run test:e2e                 # Playwright: needs supabase start + functions:serve + dev server
npm run build                    # Next.js production build
npm run build:worker             # OpenNext Cloudflare Worker build
```

`PW_CHROMIUM_PATH=/path/to/chrome` makes Playwright use an existing Chromium.

The end-to-end suite walks the full journey: signup with email confirmation → create listing → a renamed `.exe`
is rejected → valid XML and PNG are accepted → submit → hidden while pending → admin downloads the quarantined
bytes, records a ClamAV result for their SHA-256 and approves → anonymous download redirects to login →
signed-in download returns identical bytes and is counted once → review and favorite → replacing the file sends
the listing back to review. It also checks headers, 404s, admin access control, anonymous reports, copyright
form, profile/avatar re-encoding and phone-width layouts.

## Deploying for free

You need a GitHub (or local) copy of this repo, a **Supabase** account and a **Cloudflare** account. Neither
needs a payment method for this setup. Do not add one.

### Automatic (recommended)

`.github/workflows/deploy.yml` does every step below on each push to `main`. It needs two repository secrets:

- `SUPABASE_ACCESS_TOKEN` from supabase.com/dashboard/account/tokens
- `CLOUDFLARE_API_TOKEN` from the "Edit Cloudflare Workers" template, plus **Account → Turnstile → Edit**

The project ref and public key live in `spies.deploy.json`. `scripts/ci-setup.mjs` reads the Supabase keys,
derives the processor secret, hash salt and scanner password from the Supabase secret key, creates the
Turnstile widget and the scanner moderator account, and configures Auth. The site is served at
`https://spies.<your-subdomain>.workers.dev`.

**Email.** Supabase's built-in email only delivers to the project's own team, so `emailConfirmation` is
`false` in `spies.deploy.json`: new accounts are active immediately (Turnstile still blocks bots), and password
reset emails will not reach the public. To turn both on, add a free SMTP provider (for example Brevo or Resend)
under Supabase → Authentication → Emails → SMTP, then set `emailConfirmation` to `true`.

The manual steps below are the same thing done by hand.

### 1. Supabase project (Free plan)

1. Create a project at https://supabase.com/dashboard in an organization on the **Free** plan.
2. Link and push the schema:
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```
3. Deploy the Edge Function and its secret:
   ```bash
   openssl rand -hex 32                    # → PROCESSOR_SECRET
   npx supabase secrets set PROCESSOR_SECRET=<value>
   npx supabase functions deploy process-upload --no-verify-jwt
   ```
   (`--no-verify-jwt` is intentional: the function authenticates the web server with `PROCESSOR_SECRET` and
   rejects everything else.)
4. **Authentication → URL configuration**: Site URL `https://spies.<your-subdomain>.workers.dev`; add
   `https://spies.<your-subdomain>.workers.dev/auth/confirm` to Redirect URLs.
5. **Authentication → Emails → Templates**: paste `supabase/templates/confirmation.html` into *Confirm signup*
   and `supabase/templates/recovery.html` into *Reset password* (the hosted project does not read `config.toml`).
6. **Authentication → Providers → Email**: keep *Confirm email* on; set minimum password length 10 with
   letters and digits.
7. **Authentication → Attack Protection**: enable CAPTCHA, provider Turnstile, with your Turnstile **secret** key.
8. **Project Settings → API Keys**: copy the publishable key (`sb_publishable_…`) and create a secret key
   (`sb_secret_…`). The secret key goes **only** into Cloudflare secrets.

Supabase's built-in email sender is rate limited and meant for testing; for real traffic configure a free SMTP
provider under Authentication → SMTP.

### 2. Turnstile

Cloudflare dashboard → Turnstile → Add widget (Managed), hostname `spies.<your-subdomain>.workers.dev`. Note the
site key and secret key.

### 3. Cloudflare Worker (Free plan)

```bash
npx wrangler login
# Public values are inlined at build time, so put them in .env.production (or the shell) before building:
#   NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_TURNSTILE_SITE_KEY
npx wrangler secret put SUPABASE_SECRET_KEY
npx wrangler secret put PROCESSOR_SECRET
npx wrangler secret put ACTOR_HASH_SALT
npx wrangler secret put TURNSTILE_SECRET_KEY
npm run deploy
```

Non-secret server settings (`DOWNLOAD_REQUIRE_LOGIN`, `UPLOADS_PAUSED`, `LIMIT_*`) can be added as `vars` in
`wrangler.jsonc`. Never set `TURNSTILE_DISABLED=true` in production.

The app deploys to `https://spies.<your-subdomain>.workers.dev`. `wrangler.jsonc` uses no paid bindings (no R2,
KV, D1, Durable Objects, Images or Queues).

## Creating the first admin

Sign up normally on the site and confirm your email, then in the Supabase SQL editor run:

```sql
update public.profiles set role = 'admin' where username = 'your_username';
```

After that, promote moderators from **Admin → Users**. Admins cannot change their own role from the UI, and roles
are read from the database, never from user-editable JWT metadata.

## Moderation and scanning

- **Automatic scanning.** `.github/workflows/scan.yml` runs every 5 minutes on GitHub's free runners (it stops at once when nothing is waiting): it installs
  ClamAV, updates signatures, signs in as a dedicated moderator account and scans every pending file with
  `scripts/admin-scan.mjs`. Clean files publish their listing automatically; infected files are flagged and
  never downloadable. It needs only the `SUPABASE_ACCESS_TOKEN` secret and signs in as the scanner moderator
  account with a one-time login, so the scanning step never holds a key that bypasses Row Level Security.
- **Keep-alive.** `.github/workflows/keepalive.yml` pings the database daily so the free Supabase project is
  never paused, and re-enables both workflows so GitHub does not switch them off after 60 quiet days.
- **Admin → Overview → Publishing** switches between auto-publish (default) and manual approval.
- **Admin → Review queue** lists listings waiting for approval (manual mode) and files waiting for a scan.
- You can also scan by hand with `npm run admin:scan`: see [docs/MANUAL_SCANNING.md](docs/MANUAL_SCANNING.md).
- **Admin → Reports** handles abuse, malware and copyright reports. A copyright complaint needs claimant name,
  contact email, listing and a good-faith statement; remove the listing if the claim is plausible.
- **Admin → Users**: suspend accounts (their listings disappear and downloads stop) and set roles.
- **Admin → Audit log**: every status change, scan, moderation decision, role change and report.
- **Admin → Overview**: storage use vs. the free allowance, queues, configuration health, and a cleanup button
  for abandoned uploads.

## Free-tier limits (checked 2026-10-19)

| Service | Limit that matters | How SPIES stays inside it |
|---|---|---|
| Cloudflare Workers Free | 100,000 requests/day (then error 1027, no charge); 10 ms CPU/request; 128 MB memory; 50 subrequests; 64 MiB uncompressed worker (OpenNext docs still say 3 MiB gzipped on Free); 100 MB request body | Heavy work runs in the Edge Function; files never pass through the Worker |
| Supabase Free | 2 projects; 500 MB database; **1 GB storage**; 5 GB uncached + 5 GB cached egress/month; 50,000 MAU; **pauses after 7 days of inactivity**; 50 MB max object | 20 MB per file, 150 MB per user, uploads refused at 800 MB total (HTTP 507 with a clear message); downloads need an account by default to protect egress; screenshots re-encoded and capped |
| Supabase Edge Functions Free | 500,000 invocations/month; 2 s CPU; 256 MB memory; 150 s wall clock | One invocation per upload; ZIP/image limits keep CPU low |
| Supabase signed URLs | Upload URLs valid 2 hours; download URLs custom expiry | Download URLs live 60 s |
| Turnstile Free | 20 widgets, 10 hostnames each, unlimited challenges | One widget |
| ClamAV | Free, open source (stable 1.5.4, LTS 1.4.6) | Runs on the admin's computer |

None of these services bill on the free plan; going over a limit produces errors (or a paused project), not
charges. Keep the Supabase organization on the Free plan and do not add a payment method to Cloudflare Workers.

## Security model

- **Secrets**: only `NEXT_PUBLIC_*` values reach the browser. `SUPABASE_SECRET_KEY`, `PROCESSOR_SECRET`,
  `ACTOR_HASH_SALT` and `TURNSTILE_SECRET_KEY` live in Worker secrets / `.env.local` (gitignored). The e2e suite
  asserts that pages contain no secret.
- **Database**: RLS on every table; client privileges revoked and granted per column. Users can edit only
  `username`, `display_name`, `bio`, and listing metadata. Status, counts, roles, bans, scan data and approvals
  change only through `SECURITY DEFINER` functions that check the caller's role.
- **Uploads**: allowlist per platform; DLL/JAR/EXE/scripts/source/credentials refused with explanations; content
  sniffed server-side; names sanitized; keys random; private quarantine; screenshots re-encoded.
- **Abuse**: Turnstile on signup, login, password reset, new submissions and reports; database-backed rate
  limits that fail closed; one review per user per template, no self-reviews, max 10 reviews/day; downloads
  de-duplicated per actor per 24 h with salted hashes (raw IPs are not stored).
- **Headers**: nonce-based CSP with `strict-dynamic`, `frame-ancestors 'none'`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`, HSTS in production, no `X-Powered-By`.
- **Honesty**: the UI says "ClamAV scan passed" with the date, never "virus-free". Demo content is badged and
  has zero counts. Downloaded templates are never installed automatically.

`npm audit` currently reports advisories in build-time dependencies of `@opennextjs/cloudflare` and
`eslint-config-next` (a `glob` CLI issue). They do not ship in the Worker; update those packages when fixed
releases appear.

## Adding a platform

1. Migration: `insert into public.platforms (id, name, description, sort_order) values (...)`.
2. `supabase/functions/_shared/formats.ts`: add its formats to `FORMATS` and `PLATFORM_FORMATS`.
3. `src/lib/catalog.ts`: label and install hints. Redeploy the function and the app.

## Manual tasks remaining

1. Create a public GitHub repository, push this code, and add the two deploy secrets above.
2. Sign up on the live site, then promote yourself to admin with the SQL above.
3. Optional: add free SMTP so email confirmation and password reset work (see **Email** above).
4. Decide whether to seed demo content in production (`npm run seed:demo`), and remove it once real listings
   exist (`npm run seed:demo -- --remove`).
5. Have the acceptable-use rules and copyright process reviewed for your jurisdiction.
