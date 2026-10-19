import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTemplateBySlug } from "@/lib/data/templates";
import { getViewer, isStaff } from "@/lib/auth";
import { previewUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { formatBytes, formatCount, formatDate, formatDateTime } from "@/lib/format";
import { LICENSES, platformLabel } from "@/lib/catalog";
import { computeDownloadState, DOWNLOAD_STATE_MESSAGES } from "@/lib/download-state";
import { Gallery, type GalleryImage } from "@/components/gallery";
import { Avatar } from "@/components/site-header";
import { CategoryBadge, DemoBadge, PlatformBadge, PublicationBadge, ScanBadge } from "@/components/badges";
import { Notice } from "@/components/empty-state";
import { DeleteReviewButton, FavoriteButton, ReviewForm } from "./interactive";

export async function generateMetadata({ params }: PageProps<"/t/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const detail = await getTemplateBySlug(slug);
  if (!detail) return { title: "Template not found" };
  const robots = detail.template.publication_status === "approved" ? undefined : { index: false, follow: false };
  return { title: detail.template.title, description: detail.template.summary || undefined, robots };
}

export default async function TemplatePage({ params }: PageProps<"/t/[slug]">) {
  const { slug } = await params;
  const [detail, viewer] = await Promise.all([getTemplateBySlug(slug), getViewer()]);
  if (!detail) notFound();
  const { template: t, screenshots, files, reviews } = detail;
  const creator = t.creator as unknown as { id: string; username: string; display_name: string; bio: string; avatar_key: string | null; created_at: string };
  const isOwner = viewer?.userId === t.creator_id;
  const staff = isStaff(viewer);
  const approved = t.publication_status === "approved";

  let isFavorite = false;
  if (viewer) {
    const supabase = await createClient();
    const { data } = await supabase.from("favorites").select("template_id").eq("template_id", t.id).eq("user_id", viewer.userId).maybeSingle();
    isFavorite = !!data;
  }

  const images: GalleryImage[] = screenshots
    .filter((s) => s.status === "ready" && s.public_key && s.thumb_key)
    .map((s) => ({ id: s.id, src: previewUrl(s.public_key)!, thumb: previewUrl(s.thumb_key)!, caption: s.caption, width: s.width, height: s.height }));
  const license = LICENSES[t.license_code];
  const myReview = viewer ? reviews.find((r) => (r.author as unknown as { id: string }).id === viewer.userId) : undefined;
  const totalSize = files.reduce((n, f) => n + (f.size_bytes ?? f.declared_size_bytes), 0);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {!approved ? (
        <div className="mb-6">
          <Notice tone={t.publication_status === "rejected" || t.publication_status === "removed" ? "danger" : "warn"} title="Not public">
            Only you{staff && !isOwner ? " (as staff)" : ""} can see this page. Status: <strong>{t.publication_status}</strong>.
            {t.moderation_note ? <> Moderator note: {t.moderation_note}</> : null}{" "}
            {isOwner ? <Link className="underline" href={`/dashboard/submissions/${t.id}`}>Manage this submission</Link> : null}
          </Notice>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <PlatformBadge platformId={t.platform_id} />
        <CategoryBadge categoryId={t.category_id} />
        {t.is_demo ? <DemoBadge /> : null}
        {!approved ? <PublicationBadge status={t.publication_status} /> : null}
      </div>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-fg sm:text-3xl">{t.title}</h1>
      {t.summary ? <p className="mt-2 max-w-3xl text-fg-muted">{t.summary}</p> : null}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-8">
          <Gallery images={images} title={t.title} coverId={t.cover_screenshot_id} />

          <section aria-labelledby="desc-h">
            <h2 id="desc-h" className="mb-2 text-base font-semibold text-fg">Description</h2>
            <div className="prose-plain">{t.description || "No description provided."}</div>
          </section>

          <section aria-labelledby="install-h">
            <h2 id="install-h" className="mb-2 text-base font-semibold text-fg">Installation</h2>
            <div className="prose-plain">{t.install_steps || "The creator did not provide installation steps."}</div>
          </section>

          <section aria-labelledby="deps-h">
            <h2 id="deps-h" className="mb-2 text-base font-semibold text-fg">Dependencies</h2>
            <div className="prose-plain">{t.dependencies || "None listed."}</div>
          </section>

          <section aria-labelledby="files-h">
            <h2 id="files-h" className="mb-2 text-base font-semibold text-fg">Files</h2>
            <ul className="space-y-3">
              {files.map((f) => {
                const state = computeDownloadState(t.publication_status, f);
                return (
                  <li key={f.id} className="card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-all font-mono text-sm text-fg">{f.original_filename}</p>
                        <p className="mt-1 text-xs text-fg-subtle">
                          {formatBytes(f.size_bytes ?? f.declared_size_bytes)} · .{f.extension}
                        </p>
                      </div>
                      {state === "ok" ? (
                        <a href={`/api/download/${f.id}`} className="btn btn-primary" rel="nofollow">
                          Download
                        </a>
                      ) : (
                        <span className="btn btn-secondary pointer-events-none opacity-70" aria-disabled="true">
                          Download unavailable
                        </span>
                      )}
                    </div>
                    <div className="mt-3 space-y-1.5 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <ScanBadge status={f.scan_status} />
                        {f.scan_status === "clean" && f.scanned_at ? (
                          <span className="text-fg-muted">
                            on {formatDateTime(f.scanned_at)} with {f.scanner_name ?? "ClamAV"} {f.scanner_version}
                            {f.signature_version ? `, signatures ${f.signature_version}` : ""}
                          </span>
                        ) : null}
                      </div>
                      {f.sha256 ? (
                        <p className="break-all font-mono text-fg-subtle">
                          SHA-256 <span className="text-fg-muted">{f.sha256}</span>
                        </p>
                      ) : null}
                      {state !== "ok" ? <p className="text-warn">{DOWNLOAD_STATE_MESSAGES[state]}</p> : null}
                      {Array.isArray((f.validation_report as { entries?: unknown[] })?.entries) ? (
                        <details className="text-fg-subtle">
                          <summary className="cursor-pointer">Package contents</summary>
                          <ul className="mt-1 space-y-0.5 font-mono">
                            {((f.validation_report as { entries: { name: string; uncompressedSize: number }[] }).entries).map((e) => (
                              <li key={e.name}>{e.name} <span className="text-fg-subtle">({formatBytes(e.uncompressedSize)})</span></li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </div>
                  </li>
                );
              })}
              {files.length === 0 ? <li className="text-sm text-fg-subtle">No files are attached.</li> : null}
            </ul>
            <p className="mt-3 text-xs leading-5 text-fg-subtle">
              A passed ClamAV scan means no known malware signature matched at scan time. Antivirus scanning cannot
              guarantee that a file is harmless. Only import configuration files into your trading platform if you
              trust them, and review settings before trading live. <Link href="/security" className="underline">How files are checked</Link>.
            </p>
          </section>

          <section aria-labelledby="reviews-h">
            <h2 id="reviews-h" className="mb-3 text-base font-semibold text-fg">
              Reviews {t.rating_count > 0 ? <span className="font-normal text-fg-muted">· ★ {Number(t.rating_avg).toFixed(1)} from {t.rating_count}</span> : null}
            </h2>
            {approved && viewer && !isOwner ? (
              <div className="mb-4">
                <ReviewForm templateId={t.id} slug={t.slug} existing={myReview ? { rating: myReview.rating, body: myReview.body } : null} />
              </div>
            ) : null}
            {approved && !viewer ? (
              <p className="mb-4 text-sm text-fg-muted">
                <Link href={`/login?next=/t/${t.slug}`} className="underline">Sign in</Link> to rate this template.
              </p>
            ) : null}
            {reviews.length === 0 ? (
              <p className="text-sm text-fg-subtle">No reviews yet.</p>
            ) : (
              <ul className="space-y-3">
                {reviews.map((r) => {
                  const author = r.author as unknown as { id: string; username: string; avatar_key: string | null };
                  return (
                    <li key={r.id} className="card p-4">
                      <div className="flex items-center gap-2 text-sm">
                        <Avatar username={author.username} avatarKey={author.avatar_key} size={22} />
                        <Link href={`/u/${author.username}`} className="font-medium text-fg hover:text-accent">{author.username}</Link>
                        <span className="font-mono text-accent" aria-label={`${r.rating} out of 5`}>{"★".repeat(r.rating)}<span className="text-fg-subtle">{"★".repeat(5 - r.rating)}</span></span>
                        <span className="ml-auto text-xs text-fg-subtle">{formatDate(r.created_at)}</span>
                      </div>
                      {r.body ? <p className="prose-plain mt-2">{r.body}</p> : null}
                      {viewer && (author.id === viewer.userId || staff) ? (
                        <div className="mt-2"><DeleteReviewButton reviewId={r.id} slug={t.slug} /></div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="card space-y-3 p-4">
            <div className="flex gap-2">
              {approved ? <FavoriteButton templateId={t.id} slug={t.slug} initial={isFavorite} signedIn={!!viewer} /> : null}
              <Link href={`/report?template=${t.slug}`} className="btn btn-ghost">Report</Link>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <dt className="text-fg-subtle">Platform</dt>
              <dd className="text-fg">{platformLabel(t.platform_id)}</dd>
              <dt className="text-fg-subtle">Version</dt>
              <dd className="text-fg">{t.platform_version || "Not specified"}</dd>
              <dt className="text-fg-subtle">Downloads</dt>
              <dd className="font-mono text-fg">{formatCount(t.download_count)}</dd>
              <dt className="text-fg-subtle">Favorites</dt>
              <dd className="font-mono text-fg">{formatCount(t.favorite_count)}</dd>
              <dt className="text-fg-subtle">Files</dt>
              <dd className="text-fg">{files.length} · {formatBytes(totalSize)}</dd>
              <dt className="text-fg-subtle">Published</dt>
              <dd className="text-fg">{formatDate(t.approved_at ?? t.created_at)}</dd>
              <dt className="text-fg-subtle">Updated</dt>
              <dd className="text-fg">{formatDate(t.updated_at)}</dd>
            </dl>
            {t.tags.length ? (
              <div className="flex flex-wrap gap-1.5 border-t border-line pt-3">
                {t.tags.map((tag) => (
                  <Link key={tag} href={`/browse?q=${encodeURIComponent(tag)}`} className="rounded bg-surface-2 px-2 py-0.5 text-xs text-fg-muted hover:text-fg">
                    #{tag}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>

          <div className="card p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">License</p>
            <p className="mt-1 text-sm font-medium text-fg">{license?.label ?? t.license_code}</p>
            <p className="mt-1 text-xs text-fg-muted">{license?.summary}</p>
            {license?.url ? <a href={license.url} className="mt-1 inline-block text-xs underline" rel="noopener noreferrer" target="_blank">License text</a> : null}
            {t.license_text ? <p className="prose-plain mt-2 text-xs">{t.license_text}</p> : null}
            <p className="mt-2 text-xs text-fg-subtle">The creator declared they have the right to share these files.</p>
          </div>

          <div className="card p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">Creator</p>
            <Link href={`/u/${creator.username}`} className="mt-2 flex items-center gap-3 hover:text-accent">
              <Avatar username={creator.username} avatarKey={creator.avatar_key} size={40} />
              <div>
                <p className="text-sm font-medium text-fg">{creator.display_name || creator.username}</p>
                <p className="text-xs text-fg-subtle">@{creator.username} · joined {formatDate(creator.created_at)}</p>
              </div>
            </Link>
            {creator.bio ? <p className="mt-2 line-clamp-3 text-xs text-fg-muted">{creator.bio}</p> : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
