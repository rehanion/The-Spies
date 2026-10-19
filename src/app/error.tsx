"use client";

import Link from "next/link";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold text-fg">Something went wrong</h1>
      <p className="mt-2 text-sm text-fg-muted">
        The page could not be loaded. The database may be waking up or temporarily unavailable. Please try again in a moment.
      </p>
      {error.digest ? <p className="mt-2 font-mono text-xs text-fg-subtle">Reference {error.digest}</p> : null}
      <div className="mt-6 flex gap-2">
        <button type="button" onClick={reset} className="btn btn-primary">Try again</button>
        <Link href="/" className="btn btn-secondary">Home</Link>
      </div>
    </div>
  );
}
