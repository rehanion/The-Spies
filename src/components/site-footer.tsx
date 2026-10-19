import Link from "next/link";
import { Logo } from "@/components/logo";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 text-sm sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <Logo />
          <p className="mt-3 max-w-md text-fg-muted">
            A free community library of trading-platform templates, workspaces and study configurations. No ads, no paid
            tiers. Every file is quarantined, structurally validated and scanned with ClamAV before it can be
            downloaded, and moderators remove anything that breaks the rules.
          </p>
        </div>
        <div>
          <p className="mb-2 font-medium text-fg">Community</p>
          <ul className="space-y-1.5 text-fg-muted">
            <li><Link className="hover:text-fg" href="/browse">Browse templates</Link></li>
            <li><Link className="hover:text-fg" href="/upload">Upload a template</Link></li>
            <li><Link className="hover:text-fg" href="/rules">Acceptable use rules</Link></li>
          </ul>
        </div>
        <div>
          <p className="mb-2 font-medium text-fg">Trust &amp; safety</p>
          <ul className="space-y-1.5 text-fg-muted">
            <li><Link className="hover:text-fg" href="/security">How files are checked</Link></li>
            <li><Link className="hover:text-fg" href="/copyright">Copyright complaints</Link></li>
            <li><Link className="hover:text-fg" href="/report">Report a problem</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line py-4 text-center text-xs text-fg-subtle">
        Trading involves risk. Templates are shared by community members and are not trading advice.
      </div>
    </footer>
  );
}
