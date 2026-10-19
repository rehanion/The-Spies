import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { publicEnv } from "@/lib/env";
import { CatalogProvider } from "@/components/catalog-provider";
import { getCatalogData } from "@/lib/data/catalog";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.siteUrl()),
  title: { default: "SPIES | Trading template library", template: "%s · SPIES" },
  description:
    "Free community library of trading templates for MotiveWave, Sierra Chart, Quantower, ATAS and TradingView: footprint, TPO, volume profile, order flow and more, with screenshots.",
};

export const viewport: Viewport = {
  themeColor: "#0b0d10",
  colorScheme: "dark",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const catalog = await getCatalogData();
  return (
    <html lang="en" className={`h-full ${inter.variable}`}>
      <body className="flex min-h-full flex-col bg-bg text-fg">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded focus:bg-surface-2 focus:px-3 focus:py-2">
          Skip to content
        </a>
        <CatalogProvider data={catalog}>
        <SiteHeader />
        <main id="main" className="page-in flex-1">
          {children}
        </main>
        <SiteFooter />
        </CatalogProvider>
      </body>
    </html>
  );
}
