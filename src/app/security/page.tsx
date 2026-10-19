import type { Metadata } from "next";
import Link from "next/link";
import { BLOCKED_REASONS, FORMATS } from "@shared/formats.ts";
import { getCatalog } from "@/lib/data/catalog";
import { limits } from "@/lib/server-env";
import { formatBytes } from "@/lib/format";

export const metadata: Metadata = { title: "How files are checked" };

export default async function SecurityPage() {
  const catalog = await getCatalog();
  const l = limits();
  return (
    <article className="prose-plain mx-auto max-w-3xl space-y-6 px-4 py-8 text-sm leading-6 text-fg-muted">
      <h1 className="text-2xl font-semibold text-fg">How files are checked</h1>
      <p>
        Every template file goes through the same steps before anyone can download it. No check can prove a file is harmless, so we never call a file
        &ldquo;100% safe&rdquo;. What we show is exactly what was checked, and when.
      </p>

      <ol className="list-decimal space-y-3 pl-5">
        <li>
          <strong className="text-fg">Private quarantine.</strong> Uploads go into a private storage area under a random name. They are not reachable by any
          public link.
        </li>
        <li>
          <strong className="text-fg">Format validation on the server.</strong> The file name, browser-reported type and any hash sent by the uploader are
          ignored. The server reads the actual bytes, computes its own SHA-256 fingerprint and checks that the content matches an accepted format.
          Executables, scripts and native libraries are rejected even when renamed. ZIP packages are opened entry by entry and refused if they contain
          anything outside the allowlist, nested archives, encrypted entries, unsafe paths or suspicious compression ratios.
        </li>
        <li>
          <strong className="text-fg">Malware scan.</strong> An administrator downloads each new file and scans it with{" "}
          <a className="underline" href="https://www.clamav.net/" rel="noreferrer noopener" target="_blank">ClamAV</a> using current signatures. The scanner
          version, signature version, scan time and the SHA-256 of the scanned bytes are recorded. If the fingerprint of the scanned file does not match the
          stored file, the result is not accepted.
        </li>
        <li>
          <strong className="text-fg">Publishing and moderation.</strong> A listing goes live automatically once its files pass the scan (admins can switch the
          site to manual approval instead). Moderators review reports and remove listings, comments or accounts that break the rules.
        </li>
        <li>
          <strong className="text-fg">Compiled plugins.</strong> Some platforms use plugins (.dll or .jar files) that run code on your computer when the
          platform loads them. These are checked to be real plugins, not programs, and scanned like everything else, and a moderator always looks at the
          listing before it goes live. A scan cannot prove code is safe, so only install plugins from creators you trust.
        </li>
        <li>
          <strong className="text-fg">Controlled download.</strong> Downloads use short-lived links that are only issued while the listing is approved, the
          scan is clean and the file&apos;s fingerprint still matches what was scanned and approved. Replacing a file takes the listing offline until the new file has been scanned.
        </li>
      </ol>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-fg">What a &ldquo;ClamAV scan passed&rdquo; badge means</h2>
        <p>
          It means the exact bytes you download were scanned on the date shown and ClamAV reported no match. Antivirus engines miss new threats, and
          configuration files can still change how your platform behaves. Only import templates you understand, from creators you trust, and keep backups of
          your own workspace.
        </p>
        <p>
          You can verify a download yourself: compare its SHA-256 with the value on the template page using <code className="kbd">sha256sum file</code>{" "}
          (Linux), <code className="kbd">shasum -a 256 file</code> (macOS) or <code className="kbd">Get-FileHash file</code> (Windows PowerShell).
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-fg">Accepted formats</h2>
        <ul className="list-disc space-y-1 pl-5">
          {catalog.activePlatforms.map((x) => (
            <li key={x.id}>
              <span className="text-fg">{x.name}:</span> {x.upload_formats.map((e) => FORMATS[e]?.label ?? e).join(", ")}.
              {x.zip_formats.length ? ` ZIP packages may contain ${x.zip_formats.map((e) => `.${e}`).join(", ")}.` : null}
            </li>
          ))}
        </ul>
        <p>
          Limits: {formatBytes(l.maxTemplateFileBytes)} per file, {l.maxFilesPerTemplate} files per template, {formatBytes(l.maxScreenshotBytes)} per
          screenshot. Screenshots are converted to JPEG on the server; SVG and HTML are never served.
        </p>
        <p>Always refused: {Object.keys(BLOCKED_REASONS).map((e) => `.${e}`).join(", ")}.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-fg">Found something wrong?</h2>
        <p>
          If a file looks unsafe, do not open it. <Link className="underline" href="/report?kind=malware">Report it</Link> with your scanner&apos;s output and
          the moderators will take the listing down while they investigate.
        </p>
      </section>
    </article>
  );
}
