import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { previewUrl } from "@/lib/env";
import { formatBytes, formatDate, formatDateTime } from "@/lib/format";
import { LICENSES } from "@/lib/catalog";
import { getCatalog } from "@/lib/data/catalog";
import { PublicationBadge, ScanBadge, ValidationBadge } from "@/components/badges";
import { ModerationForm, ScanForm } from "@/components/admin/forms";

export const metadata: Metadata = { title: "Review submission" };

export default async function AdminSubmissionPage({ params }: PageProps<"/admin/submissions/[id]">) {
  const catalog = await getCatalog();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const { data: t } = await supabase
    .from("templates")
    .select("*, creator:profiles!templates_creator_id_fkey(id, username, display_name, created_at, is_banned, role)")
    .eq("id", id)
    .maybeSingle();
  if (!t) notFound();
  const [{ data: files }, { data: shots }, { data: events }, { data: reports }] = await Promise.all([
    supabase.from("template_files").select("*, scan_records(*)").eq("template_id", t.id).order("is_current", { ascending: false }).order("created_at"),
    supabase.from("template_screenshots").select("*").eq("template_id", t.id).order("position"),
    supabase.from("moderation_events").select("*").eq("template_id", t.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("reports").select("id, kind, status, details, created_at").eq("template_id", t.id).order("created_at", { ascending: false }),
  ]);
  const creator = t.creator as unknown as { id: string; username: string; display_name: string; created_at: string; is_banned: boolean; role: string };
  const current = (files ?? []).filter((f) => f.is_current);
  const canApprove =
    current.length > 0 &&
    current.every((f) => f.validation_status === "passed" && f.scan_status === "clean" && f.scanned_sha256 === f.sha256) &&
    (shots ?? []).some((s) => s.status === "ready");

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-8">
        <div>
          <Link href="/admin/queue" className="text-sm text-fg-muted hover:text-fg">← Queue</Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold text-fg">{t.title}</h2>
            <PublicationBadge status={t.publication_status} />
          </div>
          <p className="mt-1 text-sm text-fg-muted">
            {catalog.platformName(t.platform_id)} {t.platform_version} · {catalog.categoryName(t.category_id)} · by{" "}
            <Link className="underline" href={`/admin/users?q=${creator.username}`}>@{creator.username}</Link> (joined {formatDate(creator.created_at)}
            {creator.is_banned ? ", suspended" : ""}) · <Link className="underline" href={`/t/${t.slug}`}>preview page</Link>
          </p>
        </div>

        <section aria-labelledby="shots-h">
          <h3 id="shots-h" className="mb-2 text-sm font-semibold uppercase tracking-wider text-fg-muted">Screenshots (converted on the server)</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            {(shots ?? []).map((s) => (
              <figure key={s.id} className="card overflow-hidden">
                {s.public_key ? (
                  <a href={previewUrl(s.public_key)!} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previewUrl(s.thumb_key)!} alt={s.caption || "Screenshot"} className="aspect-[16/10] w-full object-cover" />
                  </a>
                ) : (
                  <div className="flex aspect-[16/10] items-center justify-center p-2 text-center text-xs text-fg-subtle">{s.status}: {s.failure_reason ?? "processing"}</div>
                )}
                <figcaption className="px-2 py-1 text-xs text-fg-muted">
                  {t.cover_screenshot_id === s.id ? "Cover · " : ""}{s.width}×{s.height} {s.caption}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section aria-labelledby="files-h">
          <h3 id="files-h" className="mb-2 text-sm font-semibold uppercase tracking-wider text-fg-muted">Files</h3>
          <ul className="space-y-4">
            {(files ?? []).map((f) => {
              const report = f.validation_report as { checks?: string[]; entries?: { name: string; uncompressedSize: number }[]; error?: string };
              return (
                <li key={f.id} id={`file-${f.id}`} className={`card p-4 ${f.is_current ? "" : "opacity-60"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-all font-mono text-sm text-fg">{f.original_filename}</span>
                    {!f.is_current ? <span className="text-xs text-fg-subtle">(superseded {formatDateTime(f.superseded_at)})</span> : null}
                    <span className="ml-auto flex gap-1.5"><ValidationBadge status={f.validation_status} /><ScanBadge status={f.scan_status} /></span>
                  </div>
                  <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[max-content_1fr]">
                    <dt className="text-fg-subtle">Server SHA-256</dt><dd className="break-all font-mono text-fg">{f.sha256 ?? "None"}</dd>
                    <dt className="text-fg-subtle">Size</dt><dd>{formatBytes(f.size_bytes)} (declared {formatBytes(f.declared_size_bytes)})</dd>
                    <dt className="text-fg-subtle">Detected</dt><dd>{f.detected_format ?? "None"}</dd>
                    <dt className="text-fg-subtle">Uploaded</dt><dd>{formatDateTime(f.uploaded_at)}</dd>
                    <dt className="text-fg-subtle">Approved hash</dt><dd className="break-all font-mono">{f.approved_sha256 ?? "None"}</dd>
                  </dl>
                  {report?.error ? <p className="mt-2 text-xs text-danger">Validation: {report.error}</p> : null}
                  {report?.checks?.length ? (
                    <ul className="mt-2 list-inside list-disc text-xs text-fg-muted">{report.checks.map((c) => <li key={c}>{c}</li>)}</ul>
                  ) : null}
                  {report?.entries?.length ? (
                    <details className="mt-2 text-xs"><summary className="cursor-pointer text-fg-muted">Archive entries ({report.entries.length})</summary>
                      <ul className="mt-1 font-mono text-fg-subtle">{report.entries.map((e) => <li key={e.name}>{e.name} ({formatBytes(e.uncompressedSize)})</li>)}</ul>
                    </details>
                  ) : null}
                  {f.scan_records?.length ? (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-fg-muted">Scan history</p>
                      <ul className="mt-1 space-y-1 text-xs text-fg-subtle">
                        {[...f.scan_records].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((s) => (
                          <li key={s.id}>
                            {formatDateTime(s.scanned_at)} · <strong className={s.result === "clean" ? "text-ok" : "text-danger"}>{s.result}</strong> · {s.scanner_name} {s.scanner_version} · sigs {s.signature_version} · hash {s.hash_match ? "matched" : "MISMATCH"}
                            {s.notes ? ` · ${s.notes}` : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {f.is_current && f.validation_status === "passed" ? (
                    <div className="mt-3">
                      <a href={`/api/admin/files/${f.id}/download`} className="btn btn-secondary h-8 px-2.5 text-xs" rel="nofollow">
                        Download quarantined file for scanning
                      </a>
                      <ScanForm fileId={f.id} templateId={t.id} expectedSha256={f.sha256 ?? ""} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="meta-h" className="space-y-3 text-sm">
          <h3 id="meta-h" className="text-sm font-semibold uppercase tracking-wider text-fg-muted">Listing details</h3>
          <p><span className="text-fg-subtle">Summary:</span> {t.summary || "None"}</p>
          <div><p className="text-fg-subtle">Description</p><p className="prose-plain">{t.description || "None"}</p></div>
          <div><p className="text-fg-subtle">Installation</p><p className="prose-plain">{t.install_steps || "None"}</p></div>
          <div><p className="text-fg-subtle">Dependencies</p><p className="prose-plain">{t.dependencies || "None"}</p></div>
          <p><span className="text-fg-subtle">License:</span> {LICENSES[t.license_code]?.label} {t.license_text ? `· ${t.license_text}` : ""}</p>
          <p><span className="text-fg-subtle">Rights attested:</span> {t.rights_attested ? "yes" : "no"} · <span className="text-fg-subtle">Tags:</span> {t.tags.join(", ") || "None"}</p>
        </section>
      </div>

      <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
        <section className="card p-4" aria-labelledby="decide-h">
          <h3 id="decide-h" className="mb-3 text-base font-semibold text-fg">Decision</h3>
          <ModerationForm templateId={t.id} status={t.publication_status} canApprove={canApprove} />
          {t.moderation_note ? <p className="mt-3 text-xs text-fg-subtle">Current note: {t.moderation_note}</p> : null}
        </section>
        {reports?.length ? (
          <section className="card p-4">
            <h3 className="mb-2 text-sm font-semibold text-fg">Reports ({reports.length})</h3>
            <ul className="space-y-2 text-xs">
              {reports.map((r) => <li key={r.id}><strong>{r.kind}</strong> · {r.status} · {formatDate(r.created_at)}<p className="text-fg-muted">{r.details}</p></li>)}
            </ul>
          </section>
        ) : null}
        <section className="card p-4">
          <h3 className="mb-2 text-sm font-semibold text-fg">Audit trail</h3>
          <ul className="max-h-96 space-y-1.5 overflow-y-auto text-xs">
            {(events ?? []).map((e) => (
              <li key={e.id}><span className="font-mono text-fg-subtle">{formatDateTime(e.created_at)}</span> <span className="font-mono text-fg">{e.action}</span></li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}
