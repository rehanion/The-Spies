import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { publicEnv } from "@/lib/env";

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.siteUrl()),
  title: { default: "SPIES | Trading template library", template: "%s · SPIES" },
  description:
    "Free community library of MotiveWave, Sierra Chart and Quantower templates: footprint, volume profile, DOM, delta and order flow workspaces with screenshots.",
};

export const viewport: Viewport = {
  themeColor: "#0b0d10",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col bg-bg text-fg">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded focus:bg-surface-2 focus:px-3 focus:py-2">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="page-in flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
