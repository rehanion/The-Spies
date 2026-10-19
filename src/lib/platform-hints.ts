import { getCatalog } from "@/lib/data/catalog";

/** Accepted file types per active platform, for upload form hints. */
export async function platformHints(): Promise<Record<string, string>> {
  const catalog = await getCatalog();
  return Object.fromEntries(catalog.activePlatforms.map((x) => [x.id, catalog.formatsText(x.id)]));
}
