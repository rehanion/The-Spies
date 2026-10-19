"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { createUploadDraft, submitForReview } from "@/app/dashboard/actions";
import { completeUpload, putWithProgress, reserveUpload } from "@/components/upload/direct-upload";
import { Turnstile } from "@/components/turnstile";
import { CATEGORY_LABELS, LICENSES, PLATFORM_LABELS } from "@/lib/catalog";
import { formatBytes } from "@/lib/format";
import { PLATFORM_FORMATS, extensionOf } from "@shared/formats.ts";

type Step = { label: string; state: "waiting" | "working" | "done" | "error"; progress?: number; message?: string };

// Guess the platform from the first file's extension (ZIPs fit several platforms).
function guessPlatform(files: File[]): string | null {
  for (const f of files) {
    const ext = extensionOf(f.name);
    const matches = Object.entries(PLATFORM_FORMATS).filter(([, fmt]) => fmt.upload.includes(ext) && ext !== "zip");
    if (matches.length === 1) return matches[0][0];
  }
  return null;
}

function titleFromFilename(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

export function UploadForm({
  siteKey,
  nonce,
  maxFileBytes,
  maxFiles,
  maxShotBytes,
  maxShots,
}: {
  siteKey: string;
  nonce?: string;
  maxFileBytes: number;
  maxFiles: number;
  maxShotBytes: number;
  maxShots: number;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const shotInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [shots, setShots] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ id: string; slug: string } | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);

  const shotPreviews = useMemo(() => shots.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })), [shots]);
  const accepted = platform ? PLATFORM_FORMATS[platform]?.upload ?? [] : Array.from(new Set(Object.values(PLATFORM_FORMATS).flatMap((f) => f.upload)));

  function addFiles(list: FileList | null) {
    const incoming = Array.from(list ?? []);
    const next = [...files, ...incoming].slice(0, maxFiles);
    setFiles(next);
    if (!platform) {
      const guess = guessPlatform(next);
      if (guess) setPlatform(guess);
    }
    if (!title && next[0]) setTitle(titleFromFilename(next[0].name));
  }

  function addShots(list: FileList | null) {
    setShots([...shots, ...Array.from(list ?? [])].slice(0, maxShots));
  }

  function problems(): string | null {
    if (!files.length) return "Add at least one template file.";
    if (!shots.length) return "Add at least one screenshot so people can see what it looks like.";
    for (const f of files) {
      const ext = extensionOf(f.name);
      if (!accepted.includes(ext)) return `${f.name}: .${ext || "?"} files are not accepted${platform ? ` for ${PLATFORM_LABELS[platform]}` : ""}.`;
      if (f.size > maxFileBytes) return `${f.name} is larger than ${formatBytes(maxFileBytes)}.`;
    }
    for (const s of shots) {
      if (!/\.(png|jpe?g|webp)$/i.test(s.name)) return `${s.name}: screenshots must be PNG, JPEG or WebP.`;
      if (s.size > maxShotBytes) return `${s.name} is larger than ${formatBytes(maxShotBytes)}.`;
    }
    return null;
  }

  async function publish(formData: FormData) {
    setError(null);
    setFieldErrors({});
    const problem = problems();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    const plan: Step[] = [
      { label: "Creating your upload", state: "working" },
      ...files.map((f) => ({ label: `Uploading ${f.name}`, state: "waiting" as const })),
      ...shots.map((s) => ({ label: `Uploading ${s.name}`, state: "waiting" as const })),
      { label: "Publishing", state: "waiting" },
    ];
    setSteps(plan);
    const update = (i: number, patch: Partial<Step>) => setSteps((st) => st?.map((s, k) => (k === i ? { ...s, ...patch } : s)) ?? null);

    let current = draft;
    if (!current) {
      const created = await createUploadDraft(formData);
      if (!created.ok) {
        update(0, { state: "error", message: created.message });
        setFieldErrors(created.fieldErrors ?? {});
        setError(created.message);
        setCaptchaKey((k) => k + 1);
        setBusy(false);
        return;
      }
      current = { id: created.id, slug: created.slug };
      setDraft(current);
    }
    update(0, { state: "done" });

    let failed = false;
    const all: { file: File; kind: "file" | "screenshot" }[] = [
      ...files.map((file) => ({ file, kind: "file" as const })),
      ...shots.map((file) => ({ file, kind: "screenshot" as const })),
    ];
    for (let i = 0; i < all.length; i++) {
      const { file, kind } = all[i];
      const step = i + 1;
      update(step, { state: "working", progress: 0 });
      try {
        const reserved = await reserveUpload({ templateId: current.id, kind, filename: file.name, size: file.size });
        await putWithProgress(reserved.uploadUrl, file, (p) => update(step, { progress: p }));
        const result = await completeUpload(reserved.id, kind);
        const good = kind === "file" ? result.status === "passed" : result.status === "ready";
        if (!good) throw new Error(result.message ?? "It was rejected.");
        update(step, { state: "done", progress: 1 });
      } catch (e) {
        failed = true;
        update(step, { state: "error", message: e instanceof Error ? e.message : "Upload failed." });
      }
    }

    const last = all.length + 1;
    if (failed) {
      update(last, { state: "error", message: "Fix the problems above on the next page, then publish." });
      setBusy(false);
      router.push(`/dashboard/submissions/${current.id}`);
      return;
    }
    update(last, { state: "working" });
    const submitted = await submitForReview(current.id);
    if (!submitted?.ok) {
      update(last, { state: "error", message: submitted?.message });
      setBusy(false);
      router.push(`/dashboard/submissions/${current.id}`);
      return;
    }
    update(last, { state: "done", message: submitted.message });
    router.push(`/t/${current.slug}?uploaded=1`);
  }

  const err = (k: string) => (fieldErrors[k] ? <p className="mt-1 text-xs text-danger">{fieldErrors[k]}</p> : null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void publish(new FormData(e.currentTarget));
      }}
      className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-6">
        <section aria-labelledby="files-h" className="space-y-3">
          <h2 id="files-h" className="text-base font-semibold text-fg">1. Template files</h2>
          <input ref={fileInput} type="file" multiple className="sr-only" aria-label="Choose template files" accept={accepted.map((e) => "." + e).join(",")} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line-strong bg-surface-2 px-6 py-10 text-center hover:border-accent"
          >
            <span aria-hidden="true" className="text-3xl">⇪</span>
            <span className="font-medium text-fg">Drag and drop files, or click to choose</span>
            <span className="text-xs text-fg-subtle">
              {accepted.map((e) => "." + e).join(", ")} · up to {formatBytes(maxFileBytes)} each · max {maxFiles}
            </span>
          </button>
          {files.length ? (
            <ul className="space-y-1.5">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-mono text-fg">{f.name}</span>
                  <span className="text-xs text-fg-subtle">{formatBytes(f.size)}</span>
                  <button type="button" disabled={busy} className="btn btn-ghost h-7 px-2 text-xs" onClick={() => setFiles(files.filter((_, k) => k !== i))} aria-label={`Remove ${f.name}`}>✕</button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section aria-labelledby="shots-h" className="space-y-3">
          <h2 id="shots-h" className="text-base font-semibold text-fg">2. Screenshots</h2>
          <input ref={shotInput} type="file" multiple className="sr-only" aria-label="Choose screenshots" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" onChange={(e) => { addShots(e.target.files); e.target.value = ""; }} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {shotPreviews.map((s, i) => (
              <div key={s.url} className="group relative aspect-video overflow-hidden rounded-xl bg-surface-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt={`Screenshot ${i + 1}`} className="h-full w-full object-cover" />
                {i === 0 ? <span className="absolute left-1.5 top-1.5 rounded bg-accent px-1.5 text-[11px] font-semibold text-accent-ink">Thumbnail</span> : null}
                <button type="button" disabled={busy} className="absolute right-1.5 top-1.5 rounded-full bg-black/70 px-2 text-xs text-white" onClick={() => setShots(shots.filter((_, k) => k !== i))} aria-label={`Remove ${s.name}`}>✕</button>
              </div>
            ))}
            {shots.length < maxShots ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => shotInput.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); addShots(e.dataTransfer.files); }}
                className="flex aspect-video flex-col items-center justify-center rounded-xl border-2 border-dashed border-line-strong text-xs text-fg-muted hover:border-accent"
              >
                <span aria-hidden="true" className="text-2xl">＋</span>
                Add image
              </button>
            ) : null}
          </div>
          <p className="text-xs text-fg-subtle">The first image is the thumbnail. PNG, JPEG or WebP. Hide account numbers and balances first.</p>
        </section>

        <section aria-labelledby="details-h" className="space-y-4">
          <h2 id="details-h" className="text-base font-semibold text-fg">3. Details</h2>
          <div>
            <label htmlFor="title" className="label">Title</label>
            <input id="title" name="title" required minLength={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} className="input" placeholder="e.g. ES footprint scalping layout" />
            {err("title")}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="platform_id" className="label">Platform</label>
              <select id="platform_id" name="platform_id" required value={platform} onChange={(e) => setPlatform(e.target.value)} className="input">
                <option value="">Choose…</option>
                {Object.entries(PLATFORM_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
              {err("platform_id")}
            </div>
            <div>
              <label htmlFor="category_id" className="label">Category</label>
              <select id="category_id" name="category_id" required defaultValue="" className="input">
                <option value="" disabled>Choose…</option>
                {Object.entries(CATEGORY_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
              {err("category_id")}
            </div>
          </div>
          <div>
            <label htmlFor="description" className="label">Description</label>
            <textarea id="description" name="description" rows={5} maxLength={10000} className="input h-auto py-2" placeholder="What does it show? Which markets and timeframes is it for? How do you use it?" />
          </div>
          <div>
            <label htmlFor="tags" className="label">Tags <span className="font-normal text-fg-subtle">(optional)</span></label>
            <input id="tags" name="tags" maxLength={400} className="input" placeholder="es, footprint, scalping" />
          </div>
          <details className="rounded-xl bg-surface-2 p-4">
            <summary className="cursor-pointer text-sm font-medium text-fg">More options (install steps, version, license)</summary>
            <div className="mt-4 space-y-4">
              <input type="hidden" name="summary" value="" />
              <div>
                <label htmlFor="install_steps" className="label">How to install</label>
                <textarea id="install_steps" name="install_steps" rows={3} maxLength={5000} className="input h-auto py-2" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="platform_version" className="label">Platform version</label>
                  <input id="platform_version" name="platform_version" maxLength={60} className="input" />
                </div>
                <div>
                  <label htmlFor="license_code" className="label">License</label>
                  <select id="license_code" name="license_code" defaultValue="free-personal" className="input">
                    {Object.entries(LICENSES).map(([id, l]) => <option key={id} value={id}>{l.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="dependencies" className="label">Requirements</label>
                <input id="dependencies" name="dependencies" maxLength={2000} className="input" placeholder="Data feed, built in studies…" />
              </div>
              <div>
                <label htmlFor="license_text" className="label">License details <span className="font-normal text-fg-subtle">(custom license only)</span></label>
                <textarea id="license_text" name="license_text" rows={2} maxLength={3000} className="input h-auto py-2" />
                {err("license_text")}
              </div>
            </div>
          </details>
        </section>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <div className="card space-y-4 p-5">
          <label className="flex items-start gap-2 text-sm text-fg-muted">
            <input type="checkbox" name="rights_attested" required className="mt-1 accent-[var(--color-accent)]" />
            <span>I made this or have the right to share it, and it contains no passwords, account details or programs.</span>
          </label>
          {err("rights_attested")}
          <Turnstile siteKey={siteKey} nonce={nonce} action="upload" resetKey={captchaKey} />
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <button type="submit" disabled={busy} className="btn btn-primary h-11 w-full rounded-full text-base">
            {busy ? "Publishing…" : "Publish"}
          </button>
          <p className="text-xs text-fg-subtle">
            Files are checked for viruses before anyone can download them. Your template goes live automatically once the scan passes.
          </p>
        </div>
        {steps ? (
          <ol className="card space-y-2 p-4 text-sm" aria-live="polite">
            {steps.map((s, i) => (
              <li key={i}>
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className={s.state === "done" ? "text-ok" : s.state === "error" ? "text-danger" : s.state === "working" ? "text-accent" : "text-fg-subtle"}>
                    {s.state === "done" ? "✓" : s.state === "error" ? "✕" : s.state === "working" ? "●" : "○"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-fg">{s.label}</span>
                  {s.state === "working" && s.progress !== undefined ? <span className="text-xs text-fg-subtle">{Math.round(s.progress * 100)}%</span> : null}
                </div>
                {s.message ? <p className={`ml-6 text-xs ${s.state === "error" ? "text-danger" : "text-fg-muted"}`}>{s.message}</p> : null}
              </li>
            ))}
          </ol>
        ) : null}
      </aside>
    </form>
  );
}
