"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { formatBytes } from "@/lib/format";
import { reorderScreenshots, setCover, updateScreenshotCaption } from "@/app/dashboard/actions";
import { completeUpload, deleteUpload, putWithProgress, reserveUpload } from "./direct-upload";

export interface ManagedShot {
  id: string;
  status: "pending" | "ready" | "failed";
  thumbUrl: string | null;
  caption: string;
  failure_reason: string | null;
  width: number | null;
  height: number | null;
}

type Job = { name: string; progress: number; state: "uploading" | "processing" | "done" | "error"; message?: string };

export function ScreenshotsManager({
  templateId,
  shots,
  coverId,
  maxBytes,
  maxCount,
  disabled,
}: {
  templateId: string;
  shots: ManagedShot[];
  coverId: string | null;
  maxBytes: number;
  maxCount: number;
  disabled?: string | null;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  async function uploadAll(files: File[]) {
    const room = Math.max(0, maxCount - shots.length);
    const batch = files.slice(0, room);
    if (files.length > room) setMessage({ ok: false, text: `Only ${maxCount} screenshots are allowed; extra files were skipped.` });
    const initial: Job[] = batch.map((f) => ({ name: f.name, progress: 0, state: "uploading" }));
    setJobs(initial);
    for (let i = 0; i < batch.length; i++) {
      const file = batch[i];
      const update = (patch: Partial<Job>) => setJobs((js) => js.map((j, k) => (k === i ? { ...j, ...patch } : j)));
      if (!/\.(png|jpe?g|webp)$/i.test(file.name)) {
        update({ state: "error", message: "Only PNG, JPEG or WebP images." });
        continue;
      }
      if (file.size > maxBytes) {
        update({ state: "error", message: `Larger than ${formatBytes(maxBytes)}.` });
        continue;
      }
      try {
        const reserved = await reserveUpload({ templateId, kind: "screenshot", filename: file.name, size: file.size });
        await putWithProgress(reserved.uploadUrl, file, (p) => update({ progress: p }));
        update({ state: "processing", progress: 1 });
        const result = await completeUpload(reserved.id, "screenshot");
        update(result.status === "ready" ? { state: "done" } : { state: "error", message: result.message ?? "The image was rejected." });
      } catch (e) {
        update({ state: "error", message: e instanceof Error ? e.message : "Upload failed." });
      }
    }
    router.refresh();
  }

  function move(index: number, delta: number) {
    const ids = shots.map((s) => s.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    start(async () => {
      const res = await reorderScreenshots(templateId, ids);
      setMessage(res ? { ok: res.ok, text: res.message } : null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <input
        ref={input}
        type="file"
        multiple
        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
        className="sr-only"
        aria-label="Choose screenshots"
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (list.length) void uploadAll(list);
        }}
      />
      {shots.length === 0 ? <p className="text-sm text-fg-subtle">At least one screenshot is required. The first processed image becomes the cover.</p> : null}
      <ol className="grid gap-3 sm:grid-cols-2">
        {shots.map((s, i) => (
          <li key={s.id} className="rounded-md border border-line bg-surface-2 p-2">
            <div className="relative aspect-[16/10] overflow-hidden rounded bg-surface-3">
              {s.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.thumbUrl} alt={s.caption || `Screenshot ${i + 1}`} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center px-3 text-center text-xs text-fg-subtle">
                  {s.status === "failed" ? s.failure_reason ?? "Rejected" : "Processing…"}
                </div>
              )}
              {coverId === s.id ? <span className="absolute left-1.5 top-1.5 rounded bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-accent-ink">Cover</span> : null}
            </div>
            <label className="sr-only" htmlFor={`cap-${s.id}`}>Caption for screenshot {i + 1}</label>
            <input
              id={`cap-${s.id}`}
              defaultValue={s.caption}
              maxLength={200}
              placeholder="Caption (optional)"
              className="input mt-2 h-8 py-1 text-xs"
              disabled={!!disabled}
              onBlur={(e) => {
                if (e.target.value !== s.caption) {
                  start(async () => {
                    const res = await updateScreenshotCaption(s.id, e.target.value);
                    setMessage(res ? { ok: res.ok, text: res.message } : null);
                  });
                }
              }}
            />
            {!disabled ? (
              <div className="mt-2 flex flex-wrap gap-1">
                <button type="button" className="btn btn-ghost h-7 px-2 text-xs" disabled={pending || i === 0} onClick={() => move(i, -1)} aria-label={`Move screenshot ${i + 1} earlier`}>↑</button>
                <button type="button" className="btn btn-ghost h-7 px-2 text-xs" disabled={pending || i === shots.length - 1} onClick={() => move(i, 1)} aria-label={`Move screenshot ${i + 1} later`}>↓</button>
                {s.status === "ready" && coverId !== s.id ? (
                  <button
                    type="button"
                    className="btn btn-ghost h-7 px-2 text-xs"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const res = await setCover(templateId, s.id);
                        setMessage(res ? { ok: res.ok, text: res.message } : null);
                        router.refresh();
                      })
                    }
                  >
                    Make cover
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost ml-auto h-7 px-2 text-xs hover:text-danger"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      try {
                        await deleteUpload(s.id, "screenshot");
                      } catch (e) {
                        setMessage({ ok: false, text: e instanceof Error ? e.message : "Could not delete." });
                      }
                      router.refresh();
                    })
                  }
                >
                  Delete
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {jobs.length ? (
        <ul className="space-y-1 text-xs" aria-live="polite">
          {jobs.map((j, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="w-40 truncate font-mono">{j.name}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded bg-surface-3">
                <span className={`block h-full ${j.state === "error" ? "bg-danger" : "bg-accent"}`} style={{ width: `${Math.round(j.progress * 100)}%` }} />
              </span>
              <span className={j.state === "error" ? "text-danger" : "text-fg-muted"}>
                {j.state === "uploading" ? `${Math.round(j.progress * 100)}%` : j.state === "processing" ? "Processing…" : j.state === "done" ? "Ready" : j.message}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {message ? <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-ok" : "text-danger"}`}>{message.text}</p> : null}
      {disabled ? (
        <p className="text-sm text-fg-subtle">{disabled}</p>
      ) : (
        <button type="button" className="btn btn-secondary" disabled={shots.length >= maxCount || jobs.some((j) => j.state === "uploading" || j.state === "processing")} onClick={() => input.current?.click()}>
          Add screenshots
        </button>
      )}
      <p className="hint">
        PNG, JPEG or WebP, up to {formatBytes(maxBytes)} each, {maxCount} max. Images are re-encoded on the server and stripped of metadata before anyone else sees them.
      </p>
    </div>
  );
}
