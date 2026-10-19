// Display metadata shared by server and client components. The database
// tables `platforms` and `categories` are the source of truth for validity;
// this file only adds presentation details.

export const PLATFORM_LABELS: Record<string, string> = {
  motivewave: "MotiveWave",
  "sierra-chart": "Sierra Chart",
  quantower: "Quantower",
};

export const CATEGORY_LABELS: Record<string, string> = {
  footprint: "Footprint",
  "volume-profile": "Volume Profile",
  dom: "DOM",
  delta: "Delta",
  absorption: "Absorption",
  "market-structure": "Market Structure",
  indicators: "Indicators",
  workspaces: "Workspaces",
  misc: "Miscellaneous",
};

export const LICENSES: Record<string, { label: string; summary: string; url?: string }> = {
  "free-personal": {
    label: "Free for personal use",
    summary: "Free to download and use for your own trading. No redistribution or resale.",
  },
  "cc-by-4.0": {
    label: "CC BY 4.0",
    summary: "Share and adapt with attribution.",
    url: "https://creativecommons.org/licenses/by/4.0/",
  },
  "cc-by-nc-4.0": {
    label: "CC BY-NC 4.0",
    summary: "Share and adapt with attribution, noncommercial use only.",
    url: "https://creativecommons.org/licenses/by-nc/4.0/",
  },
  "cc0-1.0": {
    label: "CC0 1.0 (public domain)",
    summary: "No rights reserved.",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
  },
  mit: { label: "MIT", summary: "Permissive license; keep the copyright notice.", url: "https://opensource.org/license/mit" },
  custom: { label: "Custom license", summary: "See the license text provided by the creator." },
};

export const SORTS = {
  trending: "Trending",
  recent: "Newest",
  views: "Most viewed",
  downloads: "Most downloaded",
  rating: "Top rated",
  relevance: "Best match",
} as const;
export type SortKey = keyof typeof SORTS;

export function platformLabel(id: string): string {
  return PLATFORM_LABELS[id] ?? id;
}
export function categoryLabel(id: string): string {
  return CATEGORY_LABELS[id] ?? id;
}
