import Link from "next/link";
import { CATEGORY_LABELS, PLATFORM_LABELS } from "@/lib/catalog";

/** Horizontally scrolling filter chips, like the topic bar on video sites. */
export function FilterChips({ active }: { active?: string }) {
  const chips: [string, string, string][] = [
    ["all", "All", "/"],
    ...Object.entries(PLATFORM_LABELS).map(([id, l]) => [`p:${id}`, l, `/browse?platform=${id}`] as [string, string, string]),
    ...Object.entries(CATEGORY_LABELS).map(([id, l]) => [`c:${id}`, l, `/browse?category=${id}`] as [string, string, string]),
  ];
  return (
    <nav aria-label="Topics" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-2 py-1">
        {chips.map(([key, label, href]) => (
          <li key={key}>
            <Link
              href={href}
              aria-current={active === key ? "page" : undefined}
              className={`inline-flex h-8 items-center whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors ${
                active === key ? "bg-fg text-bg" : "bg-surface-2 text-fg hover:bg-surface-3"
              }`}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
