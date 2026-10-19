import Link from "next/link";
import { previewUrl } from "@/lib/env";
import { formatCount, formatDate } from "@/lib/format";
import { CategoryBadge, DemoBadge, PlatformBadge } from "@/components/badges";
import type { TemplateListItem } from "@/lib/data/templates";

export function TemplateCard({ item }: { item: TemplateListItem }) {
  const thumb = previewUrl(item.cover_thumb_key);
  return (
    <article className="group card overflow-hidden transition-colors hover:border-line-strong">
      <Link href={`/t/${item.slug}`} className="block focus-visible:outline-offset-[-2px]">
        <div className="relative aspect-[16/10] bg-surface-2">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt={`Screenshot of ${item.title}`} loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-fg-subtle">No screenshot</div>
          )}
          <div className="absolute left-2 top-2 flex gap-1">
            <PlatformBadge platformId={item.platform_id} />
            {item.is_demo ? <DemoBadge /> : null}
          </div>
        </div>
        <div className="space-y-2 p-3">
          <h3 className="line-clamp-1 text-sm font-semibold text-fg group-hover:text-accent">{item.title}</h3>
          {item.summary ? <p className="line-clamp-2 min-h-[2.5rem] text-xs leading-5 text-fg-muted">{item.summary}</p> : null}
          <div className="flex items-center justify-between gap-2 text-xs text-fg-subtle">
            <span className="truncate">by {item.creator_display_name || item.creator_username}</span>
            <CategoryBadge categoryId={item.category_id} />
          </div>
          <dl className="flex items-center gap-3 border-t border-line pt-2 font-mono text-[11px] text-fg-subtle">
            <div className="flex gap-1">
              <dt className="sr-only">Downloads</dt>
              <dd>↓ {formatCount(item.download_count)}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="sr-only">Rating</dt>
              <dd>{item.rating_count > 0 ? `★ ${Number(item.rating_avg).toFixed(1)} (${item.rating_count})` : "No ratings"}</dd>
            </div>
            <div className="ml-auto">
              <dt className="sr-only">Published</dt>
              <dd>{formatDate(item.approved_at)}</dd>
            </div>
          </dl>
        </div>
      </Link>
    </article>
  );
}

export function TemplateGrid({ items }: { items: TemplateListItem[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((item) => (
        <TemplateCard key={item.id} item={item} />
      ))}
    </div>
  );
}
