import { CATEGORY_LABELS, PLATFORM_LABELS, SORTS } from "@/lib/catalog";

export function SearchFilters({
  q,
  platform,
  category,
  sort,
}: {
  q: string;
  platform: string;
  category: string;
  sort: string;
}) {
  return (
    <form action="/browse" method="get" role="search" className="card grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto_auto] lg:items-end">
      <div className="sm:col-span-2 lg:col-span-1">
        <label htmlFor="q" className="label">Search</label>
        <input id="q" name="q" type="search" defaultValue={q} placeholder="Name, creator, platform, tag…" className="input" maxLength={100} />
      </div>
      <div>
        <label htmlFor="platform" className="label">Platform</label>
        <select id="platform" name="platform" defaultValue={platform} className="input">
          <option value="">All platforms</option>
          {Object.entries(PLATFORM_LABELS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="category" className="label">Category</label>
        <select id="category" name="category" defaultValue={category} className="input">
          <option value="">All categories</option>
          {Object.entries(CATEGORY_LABELS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="sort" className="label">Sort by</label>
        <select id="sort" name="sort" defaultValue={sort} className="input">
          {Object.entries(SORTS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn btn-primary h-[38px]">Apply</button>
    </form>
  );
}
