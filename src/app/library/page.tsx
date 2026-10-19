import type { Metadata } from "next";
import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { previewUrl } from "@/lib/env";
import { formatDate, formatDateTime } from "@/lib/format";
import { PlatformBadge } from "@/components/badges";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Library" };

export default async function LibraryPage() {
  const viewer = await requireViewer("/library");
  const supabase = await createClient();
  // RLS limits both lists to this user's rows; embedded templates only resolve
  // while they are visible (approved, or the user's own).
  const [{ data: favorites }, { data: downloads }] = await Promise.all([
    supabase
      .from("favorites")
      .select("created_at, template:templates(id, slug, title, summary, platform_id, publication_status, cover:template_screenshots!templates_cover_fk(thumb_key))")
      .eq("user_id", viewer.userId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("download_events")
      .select("id, created_at, file:template_files(original_filename), template:templates(slug, title, platform_id)")
      .eq("user_id", viewer.userId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const favs = (favorites ?? []).filter((f) => f.template);
  const hidden = (favorites ?? []).length - favs.length;

  return (
    <div className="mx-auto max-w-7xl space-y-10 px-4 py-8 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold text-fg">Your library</h1>
        <p className="mt-1 text-sm text-fg-muted">Templates you saved and files you downloaded.</p>
      </div>

      <section aria-labelledby="fav-h" className="space-y-3">
        <h2 id="fav-h" className="text-lg font-semibold text-fg">Favorites</h2>
        {favs.length === 0 ? (
          <EmptyState title="No favorites yet" action={<Link href="/browse" className="btn btn-secondary">Browse templates</Link>}>
            Use the ☆ Save button on a template page to keep it here.
          </EmptyState>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {favs.map((f) => {
              const t = f.template!;
              const thumb = previewUrl(t.cover?.thumb_key);
              return (
                <li key={t.id} className="card flex gap-3 p-3">
                  <div className="h-16 w-24 shrink-0 overflow-hidden rounded bg-surface-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : null}
                  </div>
                  <div className="min-w-0">
                    <Link href={`/t/${t.slug}`} className="line-clamp-1 font-medium text-fg hover:text-accent">{t.title}</Link>
                    <div className="mt-1 flex items-center gap-2 text-xs text-fg-subtle">
                      <PlatformBadge platformId={t.platform_id} />
                      <span>saved {formatDate(f.created_at)}</span>
                    </div>
                    {t.publication_status !== "approved" ? <p className="mt-1 text-xs text-warn">Currently not published.</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {hidden > 0 ? <p className="hint">{hidden} saved template{hidden === 1 ? " is" : "s are"} no longer available.</p> : null}
      </section>

      <section aria-labelledby="dl-h" className="space-y-3">
        <h2 id="dl-h" className="text-lg font-semibold text-fg">Download history</h2>
        {(downloads ?? []).length === 0 ? (
          <EmptyState title="No downloads yet">Downloads you make while signed in appear here.</EmptyState>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-line text-xs text-fg-subtle">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Template</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">File</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(downloads ?? []).map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-2.5">
                      {d.template ? <Link href={`/t/${d.template.slug}`} className="text-fg hover:text-accent">{d.template.title}</Link> : <span className="text-fg-subtle">Unavailable</span>}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-fg-muted">{d.file?.original_filename ?? "None"}</td>
                    <td className="px-4 py-2.5 text-xs text-fg-subtle">{formatDateTime(d.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
