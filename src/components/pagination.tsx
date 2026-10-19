import Link from "next/link";

export function Pagination({
  page,
  pageCount,
  makeHref,
}: {
  page: number;
  pageCount: number;
  makeHref: (page: number) => string;
}) {
  if (pageCount <= 1) return null;
  const pages: number[] = [];
  for (let p = Math.max(1, page - 2); p <= Math.min(pageCount, page + 2); p++) pages.push(p);
  return (
    <nav aria-label="Pagination" className="mt-8 flex items-center justify-center gap-1 text-sm">
      {page > 1 ? (
        <Link className="btn btn-ghost" href={makeHref(page - 1)} rel="prev">
          ← Previous
        </Link>
      ) : null}
      {pages.map((p) =>
        p === page ? (
          <span key={p} aria-current="page" className="btn btn-secondary pointer-events-none">
            {p}
          </span>
        ) : (
          <Link key={p} className="btn btn-ghost" href={makeHref(p)}>
            {p}
          </Link>
        ),
      )}
      {page < pageCount ? (
        <Link className="btn btn-ghost" href={makeHref(page + 1)} rel="next">
          Next →
        </Link>
      ) : null}
    </nav>
  );
}
