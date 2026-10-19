import type { Metadata } from "next";
import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { previewUrl } from "@/lib/env";
import { formatBytes, formatCount, formatDate } from "@/lib/format";
import { limits } from "@/lib/server-env";
import { platformLabel } from "@/lib/catalog";
import { PublicationBadge } from "@/components/badges";
import { EmptyState, Notice } from "@/components/empty-state";

export const metadata: Metadata = { title: "Creator dashboard" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const viewer = await requireViewer("/dashboard");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: templates } = await supabase
    .from("templates")
    .select(
      "id, slug, title, platform_id, publication_status, moderation_note, download_count, favorite_count, rating_avg, rating_count, created_at, updated_at, cover:template_screenshots!templates_cover_fk(thumb_key), template_files(id, validation_status, scan_status, is_current, size_bytes, declared_size_bytes)",
    )
    .eq("creator_id", viewer.userId)
    .order("updated_at", { ascending: false })
    .limit(200);

  const list = templates ?? [];
  const totals = list.reduce(
    (acc, t) => ({ downloads: acc.downloads + t.download_count, approved: acc.approved + (t.publication_status === "approved" ? 1 : 0) }),
    { downloads: 0, approved: 0 },
  );
  const usedBytes = list.flatMap((t) => t.template_files.filter((f) => f.is_current && f.validation_status !== "failed")).reduce((n, f) => n + (f.size_bytes ?? f.declared_size_bytes), 0);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Creator dashboard</h1>
          <p className="mt-1 text-sm text-fg-muted">Your submissions, their review status and download statistics.</p>
        </div>
        <Link href="/upload" className="btn btn-primary">Upload a template</Link>
      </div>

      {sp.deleted ? <div className="mt-4"><Notice tone="ok">Submission deleted.</Notice></div> : null}
      {sp.password ? <div className="mt-4"><Notice tone="ok">Your password was updated.</Notice></div> : null}
      {viewer.profile.is_banned ? <div className="mt-4"><Notice tone="danger" title="Account suspended">Your account is suspended. Your listings are hidden and you cannot upload.</Notice></div> : null}

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Submissions", formatCount(list.length)],
          ["Published", formatCount(totals.approved)],
          ["Total downloads", formatCount(totals.downloads)],
          ["Template file storage", `${formatBytes(usedBytes)} of ${formatBytes(limits().perUserStorageBytes)}`],
        ].map(([k, v]) => (
          <div key={k} className="card p-4">
            <dt className="text-xs text-fg-subtle">{k}</dt>
            <dd className="mt-1 font-mono text-lg text-fg">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-8">
        {list.length === 0 ? (
          <EmptyState title="You have not uploaded anything yet" action={<Link href="/upload" className="btn btn-primary">Upload your first template</Link>}>
            Share a footprint layout, DOM setup or full workspace with screenshots.
          </EmptyState>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-line text-xs text-fg-subtle">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Template</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Files</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Downloads</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Rating</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.map((t) => {
                  const current = t.template_files.filter((f) => f.is_current);
                  const pendingScan = current.filter((f) => f.validation_status === "passed" && f.scan_status === "pending").length;
                  const cover = (t.cover as unknown as { thumb_key: string | null } | null)?.thumb_key;
                  return (
                    <tr key={t.id} className="align-top">
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/submissions/${t.id}`} className="flex items-center gap-3 hover:text-accent">
                          <span className="h-10 w-16 shrink-0 overflow-hidden rounded bg-surface-3">
                            {cover ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={previewUrl(cover)!} alt="" className="h-full w-full object-cover" />
                            ) : null}
                          </span>
                          <span>
                            <span className="block font-medium text-fg">{t.title}</span>
                            <span className="text-xs text-fg-subtle">{platformLabel(t.platform_id)}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <PublicationBadge status={t.publication_status} />
                        {t.moderation_note && t.publication_status !== "approved" ? <p className="mt-1 max-w-xs text-xs text-fg-subtle">{t.moderation_note}</p> : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-fg-muted">
                        {current.length} file{current.length === 1 ? "" : "s"}
                        {pendingScan ? <span className="block text-warn">{pendingScan} awaiting scan</span> : null}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{formatCount(t.download_count)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{t.rating_count ? `★ ${Number(t.rating_avg).toFixed(1)} (${t.rating_count})` : "—"}</td>
                      <td className="px-4 py-3 text-xs text-fg-subtle">{formatDate(t.updated_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
