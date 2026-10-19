"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { formatBytes } from "@/lib/format";
import { acceptsExtension } from "@shared/formats.ts";
import { ScanBadge, ValidationBadge } from "@/components/status-badges";
import { completeUpload, deleteUpload, putWithProgress, reserveUpload } from "./direct-upload";

export interface ManagedFile {
  id: string;
  original_filename: string;
  extension: string;
  size_bytes: number | null;
  declared_size_bytes: number;
  sha256: string | null;
  validation_status: "pending" | "passed" | "failed";
  validation_report: { error?: string; checks?: string[]; entries?: { name: string }[] } | null;
  scan_status: "pending" | "clean" | "flagged" | "error";
  scanned_at: string | null;
  /** Set when the same file is already in another listing. */
  duplicate?: { title: string | null; slug: string | null; sameCreator: boolean } | null;
}

type Job = { name: string; progress: number; phase: "uploading" | "processing" | "done" | "error"; message?: string };

export function FilesManager({
  templateId,
  files,
  accept,
  maxBytes,
  maxFiles,
  disabled,
}: {
  templateId: string;
  files: ManagedFile[];
  accept: string[];
  maxBytes: number;
  maxFiles: number;
  disabled?: string | null;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handle(file: File, replacesFileId: string | null) {
    setError(null);
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!acceptsExtension(accept, ext)) {
      setJob({ name: file.name, progress: 0, phase: "error", message: `.${ext} is not accepted for this platform. Allowed: ${accept.filter((a) => a !== "other").map((a) => "." + a).join(", ")}.` });
      return;
    }
    if (file.size > maxBytes) {
      setJob({ name: file.name, progress: 0, phase: "error", message: `The file is ${formatBytes(file.size)}; the limit is ${formatBytes(maxBytes)}.` });
      return;
    }
    setJob({ name: file.name, progress: 0, phase: "uploading" });
    try {
      const reserved = await reserveUpload({ templateId, kind: "file", filename: file.name, size: file.size, replacesFileId });
      await putWithProgress(reserved.uploadUrl, file, (p) => setJob((j) => (j ? { ...j, progress: p } : j)));
      setJob((j) => (j ? { ...j, phase: "processing", progress: 1 } : j));
      const result = await completeUpload(reserved.id, "file");
      if (result.status === "passed") setJob({ name: file.name, progress: 1, phase: "done", message: "Validated and queued for a malware scan." });
      else setJob({ name: file.name, progress: 1, phase: "error", message: result.message ?? "The file was rejected." });
    } catch (e) {
      setJob({ name: file.name, progress: 0, phase: "error", message: e instanceof Error ? e.message : "Upload failed." });
    } finally {
      setReplaceId(null);
      router.refresh();
    }
  }

  async function retry(id: string) {
    setBusyId(id);
    const result = await completeUpload(id, "file");
    if (!result.ok) setError(result.message ?? "Processing failed.");
    setBusyId(null);
    router.refresh();
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this file? If the listing is published it will go back to moderation.")) return;
    setBusyId(id);
    try {
      await deleteUpload(id, "file");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the file.");
    }
    setBusyId(null);
    router.refresh();
  }

  const busy = job?.phase === "uploading" || job?.phase === "processing";
  const canAdd = !disabled && files.length < maxFiles;

  return (
    <div className="space-y-3">
      <input
        ref={input}
        type="file"
        className="sr-only"
        aria-label="Choose a template file"
        accept={accept.includes("other") ? undefined : accept.map((a) => "." + a).join(",")}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void handle(f, replaceId);
        }}
      />
      {files.length === 0 ? <p className="text-sm text-fg-subtle">No files yet. Add at least one template file.</p> : null}
      <ul className="space-y-2">
        {files.map((f) => (
          <li key={f.id} className="rounded-md border border-line bg-surface-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="break-all font-mono text-sm text-fg">{f.original_filename}</span>
              <span className="text-xs text-fg-subtle">{formatBytes(f.size_bytes ?? f.declared_size_bytes)}</span>
              <span className="ml-auto flex flex-wrap gap-1.5">
                <ValidationBadge status={f.validation_status} />
                {f.validation_status === "passed" ? <ScanBadge status={f.scan_status} /> : null}
              </span>
            </div>
            {f.validation_status === "failed" && f.validation_report?.error ? (
              <p className="mt-2 text-xs text-danger">{f.validation_report.error}</p>
            ) : null}
            {f.duplicate ? (
              <p className="mt-2 text-xs text-warn">
                {f.duplicate.sameCreator ? "You already uploaded this exact file" : "This exact file is already on SPIES"}
                {f.duplicate.slug ? (
                  <>
                    {" in "}
                    <a className="underline" href={`/t/${f.duplicate.slug}`}>{f.duplicate.title}</a>
                  </>
                ) : null}
                . A moderator checks it before this listing goes live.
              </p>
            ) : null}
            {f.sha256 ? <p className="mt-1 break-all font-mono text-[11px] text-fg-subtle">SHA-256 {f.sha256}</p> : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {f.validation_status === "pending" ? (
                <button type="button" className="btn btn-secondary h-8 px-2.5 text-xs" disabled={busyId === f.id} onClick={() => retry(f.id)}>
                  Retry processing
                </button>
              ) : null}
              {!disabled ? (
                <button
                  type="button"
                  className="btn btn-secondary h-8 px-2.5 text-xs"
                  disabled={busy}
                  onClick={() => {
                    setReplaceId(f.id);
                    input.current?.click();
                  }}
                >
                  Replace
                </button>
              ) : null}
              {!disabled ? (
                <button type="button" className="btn btn-ghost h-8 px-2.5 text-xs hover:text-danger" disabled={busyId === f.id} onClick={() => remove(f.id)}>
                  Remove
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {job ? (
        <div className="rounded-md border border-line p-3 text-sm" aria-live="polite">
          <div className="flex justify-between gap-2">
            <span className="truncate font-mono text-xs">{job.name}</span>
            <span className="text-xs text-fg-muted">
              {job.phase === "uploading" ? `Uploading ${Math.round(job.progress * 100)}%` : job.phase === "processing" ? "Validating…" : job.phase === "done" ? "Done" : "Failed"}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.progress * 100)}>
            <div className={`h-full ${job.phase === "error" ? "bg-danger" : "bg-accent"}`} style={{ width: `${Math.round(job.progress * 100)}%` }} />
          </div>
          {job.message ? <p className={`mt-2 text-xs ${job.phase === "error" ? "text-danger" : "text-fg-muted"}`} role={job.phase === "error" ? "alert" : undefined}>{job.message}</p> : null}
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}

      {disabled ? (
        <p className="text-sm text-fg-subtle">{disabled}</p>
      ) : (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || !canAdd}
          onClick={() => {
            setReplaceId(null);
            input.current?.click();
          }}
        >
          Add template file
        </button>
      )}
      <p className="hint">
        Accepted: {accept.filter((a) => a !== "other").map((a) => "." + a).join(", ")}{accept.includes("other") ? " and most other files (no programs or scripts)" : ""} · up to {formatBytes(maxBytes)} each · {maxFiles} files max. Programs, installers, scripts and
        nested or encrypted archives are always rejected. Plugins and file types we cannot check are reviewed by a moderator.
      </p>
    </div>
  );
}
