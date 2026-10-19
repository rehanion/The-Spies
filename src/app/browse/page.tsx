import type { Metadata } from "next";
import Link from "next/link";
import { normalizeSort, searchTemplates } from "@/lib/data/templates";
import { TemplateGrid } from "@/components/template-card";
import { SearchFilters } from "@/components/search-filters";
import { Pagination } from "@/components/pagination";
import { EmptyState } from "@/components/empty-state";
import { CATEGORY_LABELS, PLATFORM_LABELS } from "@/lib/catalog";

export const metadata: Metadata = { title: "Browse templates" };

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function BrowsePage({ searchParams }: PageProps<"/browse">) {
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 100);
  const platform = one(sp.platform) in PLATFORM_LABELS ? one(sp.platform) : "";
  const category = one(sp.category) in CATEGORY_LABELS ? one(sp.category) : "";
  const sort = normalizeSort(one(sp.sort) || undefined, !!q.trim());
  const page = Number.parseInt(one(sp.page) || "1", 10) || 1;

  const result = await searchTemplates({ q, platform, category, sort, page });

  const makeHref = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (platform) params.set("platform", platform);
    if (category) params.set("category", category);
    if (sort) params.set("sort", sort);
    if (p > 1) params.set("page", String(p));
    return `/browse?${params.toString()}`;
  };

  const heading = [platform && PLATFORM_LABELS[platform], category && CATEGORY_LABELS[category]].filter(Boolean).join(" · ");

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold text-fg">{heading || "Browse templates"}</h1>
      <p className="mt-1 text-sm text-fg-muted" aria-live="polite">
        {result.total === 1 ? "1 approved template" : `${result.total.toLocaleString("en-US")} approved templates`}
        {q ? <> matching “{q}”</> : null}
      </p>
      <div className="mt-6">
        <SearchFilters q={q} platform={platform} category={category} sort={sort} />
      </div>
      <div className="mt-6">
        {result.items.length ? (
          <>
            <TemplateGrid items={result.items} />
            <Pagination page={result.page} pageCount={result.pageCount} makeHref={makeHref} />
          </>
        ) : result.page > 1 && result.total > 0 ? (
          <EmptyState title="This page is past the end of the results" action={<Link className="btn btn-secondary" href={makeHref(1)}>Back to page 1</Link>} />
        ) : (
          <EmptyState
            title="No templates match these filters"
            action={<Link className="btn btn-secondary" href="/browse">Clear filters</Link>}
          >
            Try a shorter search, another platform, or a different category.
          </EmptyState>
        )}
      </div>
    </div>
  );
}
