import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { getComments, getTemplateBySlug, searchTemplates } from "@/lib/data/templates";
import { getViewer, isStaff } from "@/lib/auth";
import { previewUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { formatBytes, formatDate, formatDateTime, plural, timeAgo } from "@/lib/format";
import { actorHash } from "@/lib/request";
import { createAdminClient } from "@/lib/supabase/admin";
import { LICENSES } from "@/lib/catalog";
import { getCatalog } from "@/lib/data/catalog";
import { computeDownloadState, DOWNLOAD_STATE_MESSAGES } from "@/lib/download-state";
import { Gallery, type GalleryImage } from "@/components/gallery";
import { Avatar } from "@/components/site-header";
import { Badge, CategoryBadge, DemoBadge, PlatformBadge, PublicationBadge, ScanBadge } from "@/components/badges";
import { Notice } from "@/components/empty-state";
import { FollowButton } from "@/components/follow-button";
import { DeleteReviewButton, FavoriteButton, ReviewForm } from "./interactive";
import { Comments, type CommentView } from "./comments";

export async function generateMetadata({ params }: PageProps<"/t/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const detail = await getTemplateBySlug(slug);
  if (!detail) return { title: "Template not found" };
  const robots = detail.template.publication_status === "approved" ? undefined : { index: false, follow: false };
  return { title: detail.template.title, description: detail.template.summary || undefined, robots };
}

export default async function TemplatePage({ params }: PageProps<"/t/[slug]">) {
  const catalog = await getCatalog();
  const { slug } = await params;
  const [detail, viewer] = await Promise.all([getTemplateBySlug(slug), getViewer()]);
  if (!detail) notFound();
  const { template: t, screenshots, files, reviews } = detail;
  const creator = t.creator as unknown as { id: string; username: string; display_name: string; bio: string; avatar_key: string | null; created_at: string };
  const isOwner = viewer?.userId === t.creator_id;
  const staff = isStaff(viewer);
  const approved = t.publication_status === "approved";

  const supabase = await createClient();
  const [favRow, followRow, creatorStats, rawComments, related] = await Promise.all([
    viewer ? supabase.from("favorites").select("template_id").eq("template_id", t.id).eq("user_id", viewer.userId).maybeSingle() : null,
    viewer ? supabase.from("follows").select("creator_id").eq("creator_id", creator.id).eq("follower_id", viewer.userId).maybeSingle() : null,
    supabase.from("profiles").select("follower_count").eq("id", creator.id).maybeSingle(),
    getComments(t.id),
    approved ? searchTemplates({ category: t.category_id, sort: "trending", pageSize: 9 }).catch(() => null) : null,
  ]);
  const isFavorite = !!favRow?.data;
  const isFollowing = !!followRow?.data;
  const followerCount = creatorStats.data?.follower_count ?? 0;

  // Count a view once per visitor per day, after the page is sent.
  if (approved && !isOwner) {
    const hash = await actorHash(viewer?.userId ?? null);
    after(async () => {
      await createAdminClient().rpc("register_view", { p_template_id: t.id, p_actor_hash: hash });
    });
  }

  type RawComment = (typeof rawComments)[number];
  const toView = (c: RawComment): CommentView => {
    const a = c.author as unknown as { id: string; username: string; display_name: string; avatar_key: string | null };
    return {
      id: c.id,
      parentId: c.parent_id,
      body: c.body,
      createdAgo: timeAgo(c.created_at),
      edited: !!c.edited_at,
      author: { id: a.id, username: a.username, displayName: a.display_name, avatarUrl: previewUrl(a.avatar_key), isCreator: a.id === creator.id },
      replies: [],
    };
  };
  const topLevel = rawComments.filter((c) => !c.parent_id).map(toView).reverse();
  const byId = new Map(topLevel.map((c) => [c.id, c]));
  for (const c of rawComments) if (c.parent_id) byId.get(c.parent_id)?.replies.push(toView(c));
  const relatedItems = (related?.items ?? []).filter((r) => r.id !== t.id).slice(0, 8);
  const downloadable = files.filter((f) => computeDownloadState(t.publication_status, f) === "ok");

  const images: GalleryImage[] = screenshots
    .filter((s) => s.status === "ready" && s.public_key && s.thumb_key)
    .map((s) => ({ id: s.id, src: previewUrl(s.public_key)!, thumb: previewUrl(s.thumb_key)!, caption: s.caption, width: s.width, height: s.height }));
  const license = LICENSES[t.license_code];
  const myReview = viewer ? reviews.find((r) => (r.author as unknown as { id: string }).id === viewer.userId) : undefined;
  const totalSize = files.reduce((n, f) => n + (f.size_bytes ?? f.declared_size_bytes), 0);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {!approved ? (
        <div className="mb-6">
          <Notice tone={t.publication_status === "rejected" || t.publication_status === "removed" ? "danger" : "warn"} title="Not public yet">
            Only you{staff && !isOwner ? " (as staff)" : ""} can see this page.{" "}
            {t.publication_status === "pending"
              ? files.some((f) => f.duplicate_of)
                ? "One of its files is already on SPIES, so a moderator looks at it after the virus scan."
                : files.some((f) => f.contains_code || f.needs_review)
                ? "Because it includes a plugin or a file type we cannot check, a moderator looks at it after the virus scan."
                : "It goes live automatically once the virus scan has passed."
              : <>Status: <strong>{t.publication_status}</strong>.</>}
            {t.moderation_note ? <> Note: {t.moderation_note}</> : null}{" "}
            {isOwner ? <Link className="underline" href={`/dashboard/submissions/${t.id}`}>Manage this upload</Link> : null}
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <Gallery images={images} title={t.title} coverId={t.cover_screenshot_id} />

          <div>
            <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">{t.title}</h1>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Link href={`/u/${creator.username}`} className="flex min-w-0 items-center gap-3">
                  <Avatar username={creator.username} avatarKey={creator.avatar_key} size={40} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-fg hover:text-accent">{creator.display_name || creator.username}</span>
                    <span className="block text-xs text-fg-subtle">@{creator.username}</span>
                  </span>
                </Link>
                <FollowButton
                  creatorId={creator.id}
                  initialFollowing={isFollowing}
                  initialCount={followerCount}
                  signedIn={!!viewer}
                  isSelf={isOwner}
                  nextPath={`/t/${t.slug}`}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {downloadable.length ? (
                  <a href={`/api/download/${downloadable[0].id}`} className="btn btn-primary rounded-full px-5" rel="nofollow">
                    ↓ Download{downloadable.length > 1 ? " main file" : ""}
                  </a>
                ) : null}
                {approved ? <FavoriteButton templateId={t.id} slug={t.slug} initial={isFavorite} signedIn={!!viewer} /> : null}
                <Link href={`/report?template=${t.slug}`} className="btn btn-ghost rounded-full">⚑ Report</Link>
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-surface-2 p-4">
            <p className="text-sm font-medium text-fg">
              {plural(t.view_count, "view")} · {plural(t.download_count, "download")} · {timeAgo(t.approved_at ?? t.created_at)}
              {t.rating_count > 0 ? <> · ★ {Number(t.rating_avg).toFixed(1)} ({t.rating_count})</> : null}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <PlatformBadge platformId={t.platform_id} />
              <CategoryBadge categoryId={t.category_id} />
              {t.is_demo ? <DemoBadge /> : null}
              {!approved ? <PublicationBadge status={t.publication_status} /> : null}
              {t.tags.map((tag) => (
                <Link key={tag} href={`/browse?q=${encodeURIComponent(tag)}`} className="text-xs text-accent hover:underline">#{tag}</Link>
              ))}
            </div>
            {t.summary ? <p className="mt-3 text-sm text-fg">{t.summary}</p> : null}
            <div className="prose-plain mt-2 text-sm">{t.description || null}</div>
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-medium text-fg">Installation, requirements and license</summary>
              <div className="mt-3 space-y-4">
                <div>
                  <h2 className="text-sm font-semibold text-fg">How to install</h2>
                  <div className="prose-plain mt-1">{t.install_steps || "The creator did not provide installation steps."}</div>
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-fg">Requirements</h2>
                  <p className="mt-1 text-fg-muted">
                    {catalog.platformName(t.platform_id)}{t.platform_version ? ` ${t.platform_version}` : ""}. {t.dependencies || "No other dependencies listed."}
                  </p>
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-fg">License: {license?.label ?? t.license_code}</h2>
                  <p className="mt-1 text-fg-muted">{license?.summary}</p>
                  {license?.url ? <a href={license.url} className="text-xs underline" rel="noopener noreferrer" target="_blank">License text</a> : null}
                  {t.license_text ? <p className="prose-plain mt-1 text-xs">{t.license_text}</p> : null}
                  <p className="mt-1 text-xs text-fg-subtle">The creator declared they have the right to share these files.</p>
                </div>
              </div>
            </details>
          </div>

          <section aria-labelledby="files-h">
            <h2 id="files-h" className="mb-2 text-lg font-semibold text-fg">Files <span className="text-sm font-normal text-fg-subtle">({files.length} · {formatBytes(totalSize)})</span></h2>
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
                        <a href={`/api/download/${f.id}`} className="btn btn-secondary rounded-full" rel="nofollow">
                          ↓ Download
                        </a>
                      ) : (
                        <span className="btn btn-secondary pointer-events-none rounded-full opacity-70" aria-disabled="true">
                          Download unavailable
                        </span>
                      )}
                    </div>
                    <div className="mt-3 space-y-1.5 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <ScanBadge status={f.scan_status} />
                        {f.contains_code ? (
                          <Badge tone="warn" title="This file runs code inside your trading platform when it is loaded.">Compiled plugin</Badge>
                        ) : null}
                        {f.scan_status === "clean" && f.scanned_at ? (
                          <span className="text-fg-muted">
                            on {formatDateTime(f.scanned_at)} with {f.scanner_name ?? "ClamAV"} {f.scanner_version}
                            {f.signature_version ? `, signatures ${f.signature_version}` : ""}
                          </span>
                        ) : null}
                      </div>
                      {f.contains_code ? (
                        <p className="text-warn">
                          This plugin runs code on your computer when your platform loads it. A moderator reviewed the listing and it passed the
                          scan, but no scan can prove code is safe. Only install it if you trust the creator.
                        </p>
                      ) : null}
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
            <h2 id="reviews-h" className="mb-3 text-lg font-semibold text-fg">
              Ratings {t.rating_count > 0 ? <span className="text-sm font-normal text-fg-muted">· ★ {Number(t.rating_avg).toFixed(1)} from {t.rating_count}</span> : null}
            </h2>
            {approved && viewer && !isOwner ? (
              <div className="mb-4">
                <ReviewForm templateId={t.id} slug={t.slug} existing={myReview ? { rating: myReview.rating, body: myReview.body } : null} />
              </div>
            ) : null}
            {approved && !viewer ? (
              <p className="mb-4 text-sm text-fg-muted">
                <Link href={`/login?next=/t/${t.slug}`} className="text-accent hover:underline">Sign in</Link> to rate this template.
              </p>
            ) : null}
            {reviews.length === 0 ? (
              <p className="text-sm text-fg-subtle">No ratings yet.</p>
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

          {approved ? (
            <Comments
              templateId={t.id}
              slug={t.slug}
              count={t.comment_count}
              comments={topLevel}
              viewer={viewer?.profile ? { id: viewer.userId, username: viewer.profile.username, avatarUrl: previewUrl(viewer.profile.avatar_key) } : null}
              staff={staff}
              canComment={!!viewer?.profile && !viewer.profile.is_banned}
            />
          ) : null}
        </div>

        <aside className="space-y-3" aria-labelledby="related-h">
          <h2 id="related-h" className="text-sm font-semibold text-fg">More like this</h2>
          {relatedItems.length === 0 ? <p className="text-sm text-fg-subtle">Nothing similar yet.</p> : null}
          <ul className="space-y-3">
            {relatedItems.map((r) => {
              const thumb = previewUrl(r.cover_thumb_key);
              return (
                <li key={r.id}>
                  <Link href={`/t/${r.slug}`} className="group flex gap-2">
                    <span className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {thumb ? <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="line-clamp-2 text-sm font-medium text-fg group-hover:text-accent">{r.title}</span>
                      <span className="mt-1 block truncate text-xs text-fg-subtle">{r.creator_display_name || r.creator_username}</span>
                      <span className="block text-xs text-fg-subtle">{plural(r.view_count, "view")} · {timeAgo(r.approved_at)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
    </div>
  );
}
