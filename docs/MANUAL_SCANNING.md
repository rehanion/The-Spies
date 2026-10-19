# Manual malware scanning with ClamAV

> **Normally you do not need this.** The hourly GitHub Actions job
> (`.github/workflows/scan.yml`) runs the same scanner automatically on GitHub's
> free runners. This page is the fallback for when that job is paused, failing,
> or you want to scan a file yourself.

The free Worker and Supabase tiers have no room for an antivirus engine
(ClamAV signatures alone are ~300 MB), so scanning happens on a separate
machine: either the GitHub runner or your own computer with
[ClamAV](https://www.clamav.net/)
(free, open source), which records the result. A file cannot be approved or
downloaded until a clean result is recorded for **the exact bytes stored**.

What is recorded for every scan: scanner name and engine version, signature
database version/date, scan time, the SHA-256 of the bytes you scanned, the
result (clean / flagged / error) and the scanner output. If your SHA-256 does
not match the server's hash, the result is stored as an **error** and approval
stays blocked.

The public badge says **"ClamAV scan passed"** with the date. Never describe a
file as "100% safe" or "virus-free": antivirus tools only detect known threats.

## 1. Install ClamAV and update signatures

| OS | Install | Update signatures |
|---|---|---|
| Ubuntu / Debian | `sudo apt install clamav` | `sudo systemctl stop clamav-freshclam; sudo freshclam` |
| Fedora | `sudo dnf install clamav clamav-update` | `sudo freshclam` |
| macOS (Homebrew) | `brew install clamav` then copy `$(brew --prefix)/etc/clamav/freshclam.conf.sample` to `freshclam.conf` and delete its `Example` line | `freshclam` |
| Windows | Installer from https://www.clamav.net/downloads, then copy `conf_examples\freshclam.conf.sample` to `freshclam.conf` and delete the `Example` line | `freshclam.exe` |

Check it works: `clamscan --version` should print something like
`ClamAV 1.5.4/27801/Mon Oct 19 08:23:01 2026` (engine / daily signature version /
signature date). Run `freshclam` before every scanning session.

## 2a. Scan with the helper script (recommended)

From a checkout of this repository on your computer:

```bash
npm install
# .env.local only needs the two PUBLIC values for this script:
#   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
npm run admin:scan                 # prompts for your admin email and password
npm run admin:scan -- --dry-run    # scan and print, record nothing
npm run admin:scan -- --clamscan "C:\Program Files\ClamAV\clamscan.exe"
```

The script signs in with **your own admin account** (it never needs the
Supabase secret key), downloads each waiting file from the private quarantine
bucket into a temporary folder under a random `.bin` name, checks the hash,
runs `clamscan`, records the result and deletes the temporary copy. It never
opens or executes a file. Exit code 0 means every file was recorded.

Then open **Admin → Review queue**, look at each listing and its screenshots,
and approve or reject it.

## 2b. Scan by hand

1. Admin → listing → **Download quarantined file for scanning**. Save it
   somewhere outside your normal folders. Do not open it.
2. Hash it:
   - Linux: `sha256sum file.bin`
   - macOS: `shasum -a 256 file.bin`
   - Windows PowerShell: `Get-FileHash file.bin -Algorithm SHA256`
3. Scan it: `clamscan --no-summary --stdout file.bin`
   (exit code 0 = no virus found, 1 = virus found, 2 = error).
4. Fill in the **Record scan result** form with the result, engine version,
   signature version, the SHA-256 from step 2 and the time. Paste the scanner
   output into the optional field.
5. Delete the downloaded copy.

## What to do when a file is flagged

- Record it as **flagged** (the script does this automatically). Downloads are
  blocked and the listing cannot be approved.
- Reject or remove the listing with a short reason. Consider suspending the
  account if it was deliberate.
- False positives happen with custom signatures; if you are sure, ask the
  creator for a clean re-export rather than overriding the result.

## When results become invalid

- The creator replaces a file → the new version needs a new scan and the
  listing returns to review.
- The stored hash ever changes → the scan resets and downloads stop.
- Re-scan old files periodically after major signature updates if you want;
  recording a new result keeps the history in `scan_records`.
