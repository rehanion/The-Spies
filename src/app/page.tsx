import Link from "next/link";
import { getViewer } from "@/lib/auth";
import { searchTemplates } from "@/lib/data/templates";
import { TemplateGrid } from "@/components/template-card";
import { EmptyState, Notice } from "@/components/empty-state";
import { FilterChips } from "@/components/chips";

export const dynamic = "force-dynamic";

function Shelf({ id, title, href, children }: { id: string; title: string; href?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="py-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 id={id} className="text-xl font-semibold text-fg">{title}</h2>
        {href ? <Link href={href} className="text-sm font-medium text-accent hover:underline">See all</Link> : null}
      </div>
      {children}
    </section>
  );
}

export default async function HomePage() {
  const viewer = await getViewer();
  const [trending, fresh, following] = await Promise.all([
    searchTemplates({ sort: "trending", pageSize: 8 }),
    searchTemplates({ sort: "recent", pageSize: 8 }),
    viewer ? searchTemplates({ following: true, sort: "recent", pageSize: 4 }) : null,
  ]);
  const hasDemo = [...trending.items, ...fresh.items].some((i) => i.is_demo);
  const empty = trending.items.length === 0;

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6">
      <FilterChips active="all" />

      {!viewer ? (
        <section className="mt-4 flex flex-col gap-4 rounded-2xl bg-surface-2 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-fg">Share and discover trading layouts</h1>
            <p className="mt-1 text-sm text-fg-muted">
              Free templates for MotiveWave, Sierra Chart, Quantower, ATAS and TradingView. Every file is virus scanned before it goes live.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/signup" className="btn btn-primary rounded-full px-5">Join free</Link>
            <Link href="/browse" className="btn btn-secondary rounded-full px-5">Explore</Link>
          </div>
        </section>
      ) : (
        <h1 className="sr-only">SPIES home</h1>
      )}

      {hasDemo ? (
        <div className="mt-4">
          <Notice title="Demo content">
            Listings marked <strong>Demo</strong> are samples, not real community uploads. Their counts start at zero.
          </Notice>
        </div>
      ) : null}

      {following && following.items.length ? (
        <Shelf id="following-h" title="From creators you follow" href="/feed">
          <TemplateGrid items={following.items} />
        </Shelf>
      ) : null}

      {empty ? (
        <div className="py-10">
          <EmptyState title="Nothing here yet" action={<Link href="/upload" className="btn btn-primary rounded-full px-5">Upload the first template</Link>}>
            Templates appear here as soon as they pass the automatic checks.
          </EmptyState>
        </div>
      ) : (
        <>
          <Shelf id="trending-h" title="Trending" href="/browse?sort=trending">
            <TemplateGrid items={trending.items} />
          </Shelf>
          <Shelf id="new-h" title="New uploads" href="/browse?sort=recent">
            <TemplateGrid items={fresh.items} />
          </Shelf>
        </>
      )}
    </div>
  );
}
