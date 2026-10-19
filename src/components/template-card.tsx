import Link from "next/link";
import { previewUrl } from "@/lib/env";
import { formatCount, plural, timeAgo } from "@/lib/format";
import { DemoBadge, PlatformBadge } from "@/components/badges";
import { Avatar } from "@/components/site-header";
import type { TemplateListItem } from "@/lib/data/templates";

// Video-site style card: big thumbnail, then avatar, title, creator and stats.
export function TemplateCard({ item, eager = false }: { item: TemplateListItem; eager?: boolean }) {
  const thumb = previewUrl(item.cover_thumb_key);
  return (
    <article className="group">
      <Link href={`/t/${item.slug}`} className="block rounded-xl focus-visible:outline-offset-2">
        <div className="relative aspect-video overflow-hidden rounded-xl bg-surface-2 ring-1 ring-transparent transition-[box-shadow,transform] duration-200 group-hover:-translate-y-0.5 group-hover:shadow-lg group-hover:shadow-black/30 group-hover:ring-line-strong">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" width={640} height={360} loading={eager ? "eager" : "lazy"} decoding="async" className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.04]" />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-fg-subtle">No screenshot</div>
          )}
          <div className="absolute bottom-2 left-2 flex gap-1">
            <PlatformBadge platformId={item.platform_id} />
            {item.is_demo ? <DemoBadge /> : null}
          </div>
          {item.rating_count > 0 || item.like_count > 0 ? (
            <div className="absolute bottom-2 right-2 flex gap-1 font-mono text-[11px] text-white">
              {item.like_count > 0 ? (
                <span className="rounded bg-black/75 px-1.5 py-0.5" aria-label={plural(item.like_count, "like")}>
                  ♥ {formatCount(item.like_count)}
                </span>
              ) : null}
              {item.rating_count > 0 ? (
                <span className="rounded bg-black/75 px-1.5 py-0.5">★ {Number(item.rating_avg).toFixed(1)}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </Link>
      <div className="mt-3 flex gap-3">
        <Link href={`/u/${item.creator_username}`} className="shrink-0" aria-label={`${item.creator_username}'s channel`}>
          <Avatar username={item.creator_username} avatarKey={item.creator_avatar_key} size={36} />
        </Link>
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-fg">
            <Link href={`/t/${item.slug}`} className="hover:text-accent">{item.title}</Link>
          </h3>
          <Link href={`/u/${item.creator_username}`} className="mt-1 block truncate text-xs text-fg-muted hover:text-fg">
            {item.creator_display_name || item.creator_username}
          </Link>
          <p className="text-xs text-fg-subtle">
            {plural(item.view_count, "view")} · {plural(item.download_count, "download")} · {timeAgo(item.approved_at)}
          </p>
        </div>
      </div>
    </article>
  );
}

/** `eager`: how many leading thumbnails load without waiting (the first row above the fold). */
export function TemplateGrid({ items, eager = 0 }: { items: TemplateListItem[]; eager?: number }) {
  return (
    <div className="stagger grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((item, i) => (
        <TemplateCard key={item.id} item={item} eager={i < eager} />
      ))}
    </div>
  );
}
