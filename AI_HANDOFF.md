# AI handoff

Read this first if you are an AI assistant picking up SPIES in a new chat. It holds everything decided so far. Nothing here is secret.

## What SPIES is

A free, YouTube style community site where traders share templates for MotiveWave, Sierra Chart, Quantower, ATAS and TradingView (Pine Script). Owner: GitHub user `rehanion`, who is the site admin.

Live: https://spies.spies-4082fd.workers.dev

## Owner's rules (do not break)

- Budget is zero. Never enable billing, upgrade a plan or add anything that can charge.
- Never expose the Supabase secret key, database password or any other privileged credential in client code, the repo or browser responses.
- Do not use the VirusTotal API as a feature.
- Never run an uploaded file on the server. Never install anything on a visitor's computer.
- No fake downloads, reviews, scan results or popularity. Say "ClamAV scan passed" with the date, never "100% virus free".
- Do not claim a command worked unless it did. Avoid destructive commands; ask before overwriting user data.
- Writing style for site copy, README and GitHub text: no em dashes, en dashes or spaced hyphens, few hyphenated words, short and plain.
- Only usernames are public. Emails are never shown.
- Commits: author `SPIES <spies@spies.invalid>`, one plain line, no `Co-Authored-By` or other AI trailers. The owner wants contributors hidden.
- The repo stays public (owner's choice). LICENSE is all rights reserved.
- Everything is hosted. The owner does no work on their own PC.

## Decisions so far

- Uploads publish automatically after a clean scan. Admin > Overview has a switch for manual approval.
- Listings that need a person always wait for a moderator, even with auto publish on: plugins (.dll, .jar), file types SPIES cannot check ("other" files), and listings a moderator rejected or removed before.
- Each listing needs a title, a platform, at least one file and at least one screenshot. Description, tags and the other fields are optional.
- Accepted files: known template formats per platform (.mwml, .tml, .cht, .StdyCollct, .twconfig, .xml, .json, .pine, .txt, .md, .zip, .dll, .jar) plus any other extension, except programs, scripts, installers, shortcuts, disk images, macro Office files and non ZIP archives (see `BLOCKED_REASONS` in `supabase/functions/_shared/formats.ts`). Every file's content is also checked for executable or archive signatures.
- Admins edit platforms, categories and each platform's accepted file types at /admin/catalog, and change user roles at /admin/users.
- Email confirmation is off because Supabase's free mailer only reaches the project team. To turn it on, add a free SMTP provider (Brevo, Resend) in Supabase and set `emailConfirmation` to true in `spies.deploy.json`.
- Domain: currently the free workers.dev address. A custom domain costs money, so ask first. Free options are eu.org or a renamed workers.dev subdomain.

## Stack

- Next.js 16 (App Router, `middleware.ts`, not `proxy.ts`), React 19, Tailwind v4, Inter font, OpenNext on Cloudflare Workers Free (10 ms CPU per request, so keep heavy work out of the Worker).
- Supabase Free: Postgres with RLS, Auth with Turnstile captcha, Storage, and the `process-upload` Edge Function (Deno), which does all file checks.
- ClamAV runs in GitHub Actions (`scan.yml`, every 5 minutes, exits early when nothing is waiting). The scanner signs in as a normal user with `profiles.is_scanner = true` and can only read and score files waiting for a scan.
- Logo: `src/components/logo.tsx`, white Fraunces Black Soft letter outlines. Favicon `src/app/icon.svg` says SPY.

## Where things are

| Path | What |
| --- | --- |
| `supabase/migrations/` | Schema, RLS, functions. Never edit a migration that is already live; add a new one. |
| `supabase/functions/_shared/` | File format rules, magic byte sniffing, ZIP inspection, validation. Shared with the app through the `@shared` alias. |
| `supabase/functions/process-upload/` | Validates uploads and re-encodes screenshots. |
| `src/lib/catalog.ts`, `src/lib/data/catalog.ts` | Platforms and categories, loaded from the database. |
| `src/app/admin/` | Admin pages and server actions. |
| `scripts/ci-setup.mjs` | Used by workflows: reads Supabase keys, sets up Cloudflare, Auth settings, the scanner account. |
| `scripts/admin-scan.mjs` | The ClamAV scan job. |
| `.github/workflows/` | `deploy.yml` (push to main), `scan.yml`, `keepalive.yml` (daily), `ci.yml`. |
| `docs/MANUAL_SCANNING.md` | How to scan by hand. |

## Hosting

- Supabase project ref `qpxhynrvtftfuzwczksl` (org rehanion, eu-central-1, Free).
- Cloudflare account `4082fd90e654fb3c8fc70eaa353ea368`, Worker `spies`, subdomain `spies-4082fd`.
- Repo secrets: `SUPABASE_ACCESS_TOKEN` and `CLOUDFLARE_API_TOKEN`. Everything else is derived in `scripts/ci-setup.mjs` (server secrets come from an HMAC of the Supabase secret key named `spies_server`).
- A push to main runs migrations, deploys the Edge Function, updates Auth settings and deploys the Worker.
- Hosted Supabase grants EXECUTE on new functions to anon and authenticated. Every migration must revoke it from internal functions explicitly.

## Working on it

```bash
npm ci
npx supabase start            # needs Docker
npx supabase db reset
npm run typecheck && npm run lint && npm test
npm run test:integration      # needs the local stack
npm run test:e2e              # needs the local stack and npm run dev
```

In a cloud AI session: Docker may need `nohup dockerd &`, and Supabase images may need `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`. The session usually cannot reach Cloudflare or Supabase APIs directly; check deploys with `gh run list` and `gh run view` (logs may be blocked, so scripts print `::notice::` and `::error::` annotations).

## History

All work happened on 2026-10-19:

1. Built the site and hosted it. Then added the community features (follows, comments, views) and auto publish.
2. Fixed a homepage permission bug, removed dashes from the copy and added animations.
3. Made platforms and categories editable by admins. Added ATAS, TradingView, TPO, Order Flow, VWAP and Strategies, plus .dll, .jar, .pine and .json files.
4. Did a security review and fixed it:
   - storage quotas use real object sizes, and processed files cannot be overwritten
   - a rejected listing cannot publish itself again
   - deploy secrets are kept out of package installs
   - the scanner has its own limited role
   - the daily listing limit is enforced in the database
   - scan logs show no file names
   - suspended users are fully limited
   - changing a password needs a recent sign in
5. New logo and Inter font. Rewrote the git history to hide contributors.
6. Opened uploads to any file type that is not a program, and added .tml. Made the logo white and added upload prompts.

Backup branch: `backup/2026-10-19`.

## Ideas not done yet

- Free SMTP for confirmation and password reset emails.
- A custom domain, which needs the owner's OK because it costs money.
