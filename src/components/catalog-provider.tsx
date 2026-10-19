"use client";

import { createContext, useContext, useMemo } from "react";
import { FALLBACK_CATALOG, makeCatalog, type Catalog, type CatalogData } from "@/lib/catalog";

const CatalogContext = createContext<CatalogData>(FALLBACK_CATALOG);

export function CatalogProvider({ data, children }: { data: CatalogData; children: React.ReactNode }) {
  return <CatalogContext.Provider value={data}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): Catalog {
  const data = useContext(CatalogContext);
  return useMemo(() => makeCatalog(data), [data]);
}
