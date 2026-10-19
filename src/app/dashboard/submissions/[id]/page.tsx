import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { previewUrl } from "@/lib/env";
import { limits } from "@/lib/server-env";
import { platformHints } from "@/lib/platform-hints";
import { formatDateTime } from "@/lib/format";
import { PublicationBadge } from "@/components/badges";
import { Notice } from "@/components/empty-state";
import { MetadataForm } from "@/components/upload/metadata-form";
import { FilesManager, type ManagedFile } from "@/components/upload/files-manager";
import { ScreenshotsManager } from "@/components/upload/screenshots-manager";
import { getCatalog } from "@/lib/data/catalog";
import { updateSubmission } from "../../actions";
import { SubmissionActions } from "./submission-actions";

export const metadata: Metadata = { title: "Manage submission" };

export default async function SubmissionPage({ params, searchParams }: PageProps<"/dashboard/submissions/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const viewer = await requireViewer(`/dashboard/submissions/${id}`);
  const supabase = await createClient();
  const { data: t } = await supabase.from("templates").select("*").eq("id", id).maybeSingle();
  if (!t || t.creator_id !== viewer.userId) notFound();

  const [{ data: files }, { data: shots }, { data: scans }] = await Promise.all([
    supabase
      .from("template_files")
      .select("id, original_filename, extension, size_bytes, declared_size_bytes, sha256, validation_status, validation_report, scan_status, scanned_at, duplicate_of")
      .eq("template_id", t.id)
      .eq("is_current", true)
      .order("created_at"),
    supabase
      .from("template_screenshots")
      .select("id, status, thumb_key, caption, failure_reason, width, height, position")
      .eq("template_id", t.id)
      .order("position")
      .order("created_at"),
    supabase
      .from("scan_records")
      .select("id, result, scanner_name, scanner_version, signature_version, hash_match, scanned_at, file_id")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const l = limits();
  const duplicates = new Map(
    await Promise.all(
      (files ?? [])
        .filter((f) => f.duplicate_of)
        .map(async (f) => {
          const { data } = await supabase.rpc("file_duplicate_info", { p_file_id: f.id });
          const d = data?.[0];
          return [f.id, d ? { title: d.template_title, slug: d.template_slug, sameCreator: d.same_creator } : null] as const;
        }),
    ),
  );
  const fileList = (files ?? []).map((f) => ({ ...f, duplicate: duplicates.get(f.id) ?? null })) as ManagedFile[];
  const shotList = (shots ?? []).map((s) => ({ ...s, thumbUrl: previewUrl(s.thumb_key) }));
  const readyShots = shotList.filter((s) => s.status === "ready").length;
  const passedFiles = fileList.filter((f) => f.validation_status === "passed").length;
  const blockingFiles = fileList.filter((f) => f.validation_status !== "passed").length;
  const removed = t.publication_status === "removed";
  const checklist = [
    { done: t.rights_attested, label: "Rights declaration confirmed" },
    { done: readyShots > 0, label: "At least one processed screenshot" },
    { done: passedFiles > 0 && blockingFiles === 0, label: "Every file passed structural validation" },
  ];
  const canSubmit = checklist.every((c) => c.done);
  const fileIds = new Set(fileList.map((f) => f.id));
  const relevantScans = (scans ?? []).filter((s) => fileIds.has(s.file_id));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <Link href="/dashboard" className="text-sm text-fg-muted hover:text-fg">← Dashboard</Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-fg">{t.title}</h1>
        <PublicationBadge status={t.publication_status} />
      </div>
      <p className="mt-1 text-sm text-fg-muted">
        {t.publication_status === "approved" ? (
          <>Public at <Link className="underline" href={`/t/${t.slug}`}>/t/{t.slug}</Link>. Editing details, files or screenshots sends it back to moderation.</>
        ) : (
          <>Preview: <Link className="underline" href={`/t/${t.slug}`}>/t/{t.slug}</Link> (only you and moderators can see it until it is approved).</>
        )}
      </p>

      <div className="mt-4 space-y-3">
        {sp.created ? <Notice tone="ok" title="Details saved">Now add your template files and screenshots below, then submit for review.</Notice> : null}
        {t.publication_status === "pending" ? (
          <Notice tone="warn" title="Pending review">
            Your files are in private quarantine. An administrator will scan them with ClamAV and review the listing. Downloads stay disabled until both steps succeed.
          </Notice>
        ) : null}
        {t.publication_status === "rejected" ? <Notice tone="danger" title="Rejected">{t.moderation_note ?? "No reason given."} Fix the issue and resubmit.</Notice> : null}
        {removed ? <Notice tone="danger" title="Removed">{t.moderation_note ?? "This listing was removed."}</Notice> : null}
      </div>

      <section className="card mt-6 p-5" aria-labelledby="submit-h">
        <h2 id="submit-h" className="text-base font-semibold text-fg">Review checklist</h2>
        <ul className="mt-3 space-y-1.5 text-sm">
          {checklist.map((c) => (
            <li key={c.label} className={c.done ? "text-ok" : "text-fg-muted"}>
              <span aria-hidden="true">{c.done ? "✓" : "○"}</span> {c.label}
              <span className="sr-only">{c.done ? " (done)" : " (not done)"}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4">
          <SubmissionActions templateId={t.id} status={t.publication_status} canSubmit={canSubmit} />
        </div>
      </section>

      <section className="card mt-6 p-5" aria-labelledby="files-h">
        <h2 id="files-h" className="mb-3 text-base font-semibold text-fg">Template files</h2>
        <FilesManager
          templateId={t.id}
          files={fileList}
          accept={(await getCatalog()).rules(t.platform_id)?.upload ?? []}
          maxBytes={l.maxTemplateFileBytes}
          maxFiles={l.maxFilesPerTemplate}
          disabled={removed ? "Removed listings cannot be changed." : null}
        />
        {relevantScans.length ? (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-fg-muted">Scan history</summary>
            <ul className="mt-2 space-y-1 text-xs text-fg-subtle">
              {relevantScans.map((s) => (
                <li key={s.id}>
                  {formatDateTime(s.scanned_at)} · {s.scanner_name} {s.scanner_version} · result <strong>{s.result}</strong>
                  {s.hash_match ? "" : " · hash mismatch"}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="card mt-6 p-5" aria-labelledby="shots-h">
        <h2 id="shots-h" className="mb-3 text-base font-semibold text-fg">Screenshots</h2>
        <ScreenshotsManager
          templateId={t.id}
          shots={shotList}
          coverId={t.cover_screenshot_id}
          maxBytes={l.maxScreenshotBytes}
          maxCount={l.maxScreenshotsPerTemplate}
          disabled={removed ? "Removed listings cannot be changed." : null}
        />
      </section>

      <section className="card mt-6 p-5" aria-labelledby="meta-h">
        <h2 id="meta-h" className="mb-4 text-base font-semibold text-fg">Details</h2>
        {removed ? (
          <p className="text-sm text-fg-subtle">Removed listings cannot be edited.</p>
        ) : (
          <MetadataForm action={updateSubmission} values={{ ...t, id: t.id }} submitLabel="Save changes" platformHints={await platformHints()} />
        )}
      </section>
    </div>
  );
}
