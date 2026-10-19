// Server badges. Platform and category names come from the cached catalog on
// the server, so listing cards ship no client code or catalog data for them.
// Client components import the plain badges from "./status-badges".
import "server-only";
import { getCatalog } from "@/lib/data/catalog";
import { Badge } from "@/components/status-badges";

export { Badge, DemoBadge, PublicationBadge, ScanBadge, ValidationBadge } from "@/components/status-badges";

export async function PlatformBadge({ platformId }: { platformId: string }) {
  return <Badge tone="neutral">{(await getCatalog()).platformName(platformId)}</Badge>;
}

export async function CategoryBadge({ categoryId }: { categoryId: string }) {
  return <Badge tone="neutral">{(await getCatalog()).categoryName(categoryId)}</Badge>;
}
