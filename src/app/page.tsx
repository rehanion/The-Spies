import Link from "next/link";
import { searchTemplates } from "@/lib/data/templates";
import { TemplateGrid } from "@/components/template-card";
import { EmptyState, Notice } from "@/components/empty-state";
import { CATEGORY_LABELS, PLATFORM_LABELS } from "@/lib/catalog";

export const dynamic = "force-dynamic";

const PLATFORM_BLURBS: Record<string, string> = {
  motivewave: "Analyses (.mwml) and analysis packs",
  "sierra-chart": "Chartbooks, study collections, trade window configs",
  quantower: "Workspace and template XML files",
};

export default async function HomePage() {
  const [recent, popular] = await Promise.all([
    searchTemplates({ sort: "recent", pageSize: 8 }),
    searchTemplates({ sort: "downloads", pageSize: 8 }),
  ]);
  const hasDemo = [...recent.items, ...popular.items].some((i) => i.is_demo);

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6">
      <section className="border-b border-line py-12 sm:py-16">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">Order-flow template library</p>
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          Footprint, volume profile and DOM setups shared by traders, inspected before you download.
        </h1>
        <p className="mt-4 max-w-2xl text-fg-muted">
          Browse screenshots and configuration details for MotiveWave, Sierra Chart and Quantower. Every file is held in
          private quarantine until it passes validation, a ClamAV scan and moderator review. Free for everyone.
        </p>
        <form action="/browse" method="get" role="search" className="mt-6 flex max-w-xl gap-2">
          <label htmlFor="home-search" className="sr-only">Search templates</label>
          <input id="home-search" name="q" type="search" placeholder="Try “footprint”, “delta”, “composite profile”…" className="input h-11" />
          <button type="submit" className="btn btn-primary h-11 px-5">Search</button>
        </form>
      </section>

      <section aria-labelledby="platforms-heading" className="py-10">
        <h2 id="platforms-heading" className="text-sm font-semibold uppercase tracking-wider text-fg-muted">Platforms</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {Object.entries(PLATFORM_LABELS).map(([id, label]) => (
            <Link key={id} href={`/browse?platform=${id}`} className="card p-4 transition-colors hover:border-accent/50">
              <p className="font-medium text-fg">{label}</p>
              <p className="mt-1 text-xs text-fg-subtle">{PLATFORM_BLURBS[id]}</p>
            </Link>
          ))}
        </div>
      </section>

      {hasDemo ? (
        <Notice title="Demonstration content">
          Listings marked <strong>Demo</strong> are sample data for development and testing. They are not real community
          uploads, and their counts start at zero.
        </Notice>
      ) : null}

      <section aria-labelledby="recent-heading" className="py-10">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 id="recent-heading" className="text-lg font-semibold text-fg">Recently published</h2>
          <Link href="/browse?sort=recent" className="text-sm text-fg-muted hover:text-accent">View all →</Link>
        </div>
        {recent.items.length ? (
          <TemplateGrid items={recent.items} />
        ) : (
          <EmptyState title="No templates published yet" action={<Link href="/dashboard/new" className="btn btn-primary">Share the first template</Link>}>
            Approved templates appear here once they pass scanning and review.
          </EmptyState>
        )}
      </section>

      {popular.items.some((i) => i.download_count > 0) ? (
        <section aria-labelledby="popular-heading" className="py-10">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 id="popular-heading" className="text-lg font-semibold text-fg">Most downloaded</h2>
            <Link href="/browse?sort=downloads" className="text-sm text-fg-muted hover:text-accent">View all →</Link>
          </div>
          <TemplateGrid items={popular.items.filter((i) => i.download_count > 0)} />
        </section>
      ) : null}

      <section aria-labelledby="categories-heading" className="py-10">
        <h2 id="categories-heading" className="text-lg font-semibold text-fg">Categories</h2>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {Object.entries(CATEGORY_LABELS).map(([id, label]) => (
            <Link key={id} href={`/browse?category=${id}`} className="rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-fg-muted transition-colors hover:border-line-strong hover:text-fg">
              {label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
