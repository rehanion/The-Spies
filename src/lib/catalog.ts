// Platforms and categories live in the database (admins can add more). The
// fallback below is only used if the database cannot be reached.
import { FORMATS } from "@shared/formats.ts";

export interface CatalogPlatform {
  id: string;
  name: string;
  website: string;
  description: string;
  install_hint: string;
  upload_formats: string[];
  zip_formats: string[];
  sort_order: number;
  is_active: boolean;
}
export interface CatalogCategory {
  id: string;
  name: string;
  description: string;
  sort_order: number;
}
export interface CatalogData {
  platforms: CatalogPlatform[];
  categories: CatalogCategory[];
}

const p = (id: string, name: string, upload: string[], zip: string[], sort: number): CatalogPlatform => ({
  id, name, website: "", description: "", install_hint: "", upload_formats: upload, zip_formats: zip, sort_order: sort, is_active: true,
});
const c = (id: string, name: string, sort: number): CatalogCategory => ({ id, name, description: "", sort_order: sort });

export const FALLBACK_CATALOG: CatalogData = {
  platforms: [
    p("motivewave", "MotiveWave", ["mwml", "zip", "jar"], ["mwml", "txt", "md"], 10),
    p("sierra-chart", "Sierra Chart", ["cht", "stdycollct", "twconfig", "zip", "dll"], ["cht", "stdycollct", "twconfig", "txt", "md", "dll"], 20),
    p("quantower", "Quantower", ["xml", "zip", "dll"], ["xml", "txt", "md", "dll"], 30),
    p("atas", "ATAS", ["xml", "zip", "dll"], ["xml", "txt", "md", "dll"], 40),
    p("tradingview", "TradingView", ["pine", "txt"], ["pine", "txt", "md"], 50),
  ],
  categories: [
    c("footprint", "Footprint", 10), c("tpo", "TPO", 15), c("volume-profile", "Volume Profile", 20), c("dom", "DOM", 30),
    c("order-flow", "Order Flow", 35), c("delta", "Delta", 40), c("absorption", "Absorption", 50),
    c("market-structure", "Market Structure", 60), c("vwap", "VWAP", 65), c("indicators", "Indicators", 70),
    c("strategies", "Strategies", 75), c("workspaces", "Workspaces", 80), c("misc", "Miscellaneous", 90),
  ],
};

export interface Catalog extends CatalogData {
  /** Platforms that accept new uploads. */
  activePlatforms: CatalogPlatform[];
  platformName(id: string): string;
  categoryName(id: string): string;
  platform(id: string): CatalogPlatform | undefined;
  hasPlatform(id: string): boolean;
  hasCategory(id: string): boolean;
  /** Upload and ZIP rules for the processor's format checks. */
  rules(id: string): { upload: string[]; zipInner: string[] } | null;
  /** "MotiveWave analysis (.mwml), ZIP package (.zip)" */
  formatsText(id: string): string;
}

export function makeCatalog(data: CatalogData): Catalog {
  const platforms = new Map(data.platforms.map((x) => [x.id, x]));
  const categories = new Map(data.categories.map((x) => [x.id, x]));
  return {
    ...data,
    activePlatforms: data.platforms.filter((x) => x.is_active),
    platformName: (id) => platforms.get(id)?.name ?? id,
    categoryName: (id) => categories.get(id)?.name ?? id,
    platform: (id) => platforms.get(id),
    hasPlatform: (id) => platforms.has(id),
    hasCategory: (id) => categories.has(id),
    rules: (id) => {
      const x = platforms.get(id);
      return x ? { upload: x.upload_formats, zipInner: x.zip_formats } : null;
    },
    formatsText: (id) => (platforms.get(id)?.upload_formats ?? []).map((e) => FORMATS[e]?.label ?? `.${e}`).join(", "),
  };
}

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

