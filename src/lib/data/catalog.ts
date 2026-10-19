import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { FALLBACK_CATALOG, makeCatalog, type Catalog, type CatalogData } from "@/lib/catalog";

// Platforms and categories change rarely, so each Worker keeps them for a minute.
let memo: { at: number; data: CatalogData } | null = null;
const TTL_MS = 60_000;

async function load(): Promise<CatalogData> {
  if (memo && Date.now() - memo.at < TTL_MS) return memo.data;
  const supabase = await createClient();
  const [platforms, categories] = await Promise.all([
    supabase
      .from("platforms")
      .select("id, name, website, description, install_hint, upload_formats, zip_formats, sort_order, is_active")
      .order("sort_order"),
    supabase.from("categories").select("id, name, description, sort_order").order("sort_order"),
  ]);
  if (platforms.error || categories.error || !platforms.data.length) return memo?.data ?? FALLBACK_CATALOG;
  const data: CatalogData = { platforms: platforms.data, categories: categories.data };
  memo = { at: Date.now(), data };
  return data;
}

/** Drops the cached catalog after an admin edit. */
export function invalidateCatalog() {
  memo = null;
}

export const getCatalogData = cache(load);
export const getCatalog = cache(async (): Promise<Catalog> => makeCatalog(await getCatalogData()));
