import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <p className="font-mono text-sm text-accent">404</p>
      <h1 className="mt-2 text-2xl font-semibold text-fg">Nothing here</h1>
      <p className="mt-2 text-sm text-fg-muted">
        This page does not exist, or the template is no longer available. Listings can be withdrawn by their creator or removed by moderators.
      </p>
      <div className="mt-6 flex gap-2">
        <Link href="/browse" className="btn btn-primary">Browse templates</Link>
        <Link href="/" className="btn btn-secondary">Home</Link>
      </div>
    </div>
  );
}
