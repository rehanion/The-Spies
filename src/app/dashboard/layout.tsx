import { CatalogProvider } from "@/components/catalog-provider";
import { getCatalogData } from "@/lib/data/catalog";

// The upload forms read platforms and categories on the client. Only these
// pages ship the catalog, instead of every page through the root layout.
export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return <CatalogProvider data={await getCatalogData()}>{children}</CatalogProvider>;
}
