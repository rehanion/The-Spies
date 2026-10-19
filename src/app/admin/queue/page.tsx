import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatBytes, formatDateTime } from "@/lib/format";
import { getCatalog } from "@/lib/data/catalog";
import { PublicationBadge, ScanBadge } from "@/components/badges";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Moderation queue" };

export default async function QueuePage() {
  const catalog = await getCatalog();
  const supabase = await createClient();
  const [{ data: pending }, { data: scanQueue }] = await Promise.all([
    supabase
      .from("templates")
      .select("id, title, platform_id, publication_status, submitted_at, moderation_note, creator:profiles!templates_creator_id_fkey(username), template_files(id, validation_status, scan_status, is_current)")
      .eq("publication_status", "pending")
      .order("submitted_at", { ascending: true })
      .limit(100),
    supabase
      .from("template_files")
      .select("id, original_filename, size_bytes, sha256, created_at, template_id, templates!inner(title, publication_status)")
      .eq("is_current", true)
      .eq("validation_status", "passed")
      .eq("scan_status", "pending")
      .order("created_at", { ascending: true })
      .limit(200),
  ]);

  return (
    <div className="space-y-10">
      <section aria-labelledby="review-h">
        <h2 id="review-h" className="mb-3 text-base font-semibold text-fg">Listings awaiting review (oldest first)</h2>
        {pending?.length ? (
          <ul className="card divide-y divide-line">
            {pending.map((t) => {
              const files = t.template_files.filter((f) => f.is_current);
              const ready = files.length > 0 && files.every((f) => f.validation_status === "passed" && f.scan_status === "clean");
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <Link href={`/admin/submissions/${t.id}`} className="font-medium text-fg hover:text-accent">{t.title}</Link>
                  <span className="text-xs text-fg-subtle">{catalog.platformName(t.platform_id)} · @{(t.creator as unknown as { username: string }).username}</span>
                  <PublicationBadge status={t.publication_status} />
                  <span className={`text-xs ${ready ? "text-ok" : "text-warn"}`}>{ready ? "All files scanned clean" : `${files.filter((f) => f.scan_status !== "clean").length} file(s) need scanning`}</span>
                  <span className="ml-auto text-xs text-fg-subtle">submitted {formatDateTime(t.submitted_at)}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="Nothing to review" />
        )}
      </section>

      <section id="scan" aria-labelledby="scan-h">
        <h2 id="scan-h" className="mb-1 text-base font-semibold text-fg">Files awaiting a malware scan</h2>
        <p className="mb-3 text-sm text-fg-muted">
          Download each file from its review page (or run <code className="kbd">npm run admin:scan</code> on your scanning computer), scan it with up-to-date ClamAV signatures and record the result. See <code className="kbd">docs/MANUAL_SCANNING.md</code>.
        </p>
        {scanQueue?.length ? (
          <ul className="card divide-y divide-line">
            {scanQueue.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <Link href={`/admin/submissions/${f.template_id}#file-${f.id}`} className="font-mono text-xs text-fg hover:text-accent">{f.original_filename}</Link>
                <span className="text-xs text-fg-subtle">{formatBytes(f.size_bytes)} · {(f.templates as unknown as { title: string }).title}</span>
                <ScanBadge status="pending" />
                <span className="ml-auto break-all font-mono text-[11px] text-fg-subtle">{f.sha256}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No files waiting for a scan" />
        )}
      </section>
    </div>
  );
}
