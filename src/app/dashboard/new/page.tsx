import type { Metadata } from "next";
import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { publicEnv } from "@/lib/env";
import { getNonce } from "@/lib/nonce";
import { platformHints } from "@/lib/platform-hints";
import { EMPTY_METADATA, MetadataForm } from "@/components/upload/metadata-form";
import { Notice } from "@/components/empty-state";
import { createSubmission } from "../actions";

export const metadata: Metadata = { title: "Upload a template" };

export default async function NewSubmissionPage() {
  const viewer = await requireViewer("/dashboard/new");
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <Link href="/dashboard" className="text-sm text-fg-muted hover:text-fg">← Dashboard</Link>
      <h1 className="mt-2 text-2xl font-semibold text-fg">Upload a template</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Step 1 of 3: describe your template. Next you will add files and screenshots, then submit for review.
      </p>
      <ol className="mt-4 flex gap-2 text-xs text-fg-subtle">
        <li className="rounded border border-accent/50 px-2 py-1 text-accent">1 · Details</li>
        <li className="rounded border border-line px-2 py-1">2 · Files &amp; screenshots</li>
        <li className="rounded border border-line px-2 py-1">3 · Review &amp; scan</li>
      </ol>
      {viewer.profile.is_banned ? (
        <div className="mt-6"><Notice tone="danger" title="Account suspended">You cannot upload while your account is suspended.</Notice></div>
      ) : (
        <div className="card mt-6 p-5">
          <MetadataForm
            action={createSubmission}
            values={EMPTY_METADATA}
            submitLabel="Save and continue"
            turnstile={{ siteKey: publicEnv.turnstileSiteKey(), nonce: await getNonce() }}
            platformHints={platformHints()}
          />
        </div>
      )}
      <p className="mt-4 text-xs text-fg-subtle">
        Never upload platform backups, account files or anything containing credentials. Read the <Link href="/rules" className="underline">acceptable use rules</Link>.
      </p>
    </div>
  );
}
