import type { Metadata } from "next";
import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { publicEnv } from "@/lib/env";
import { getNonce } from "@/lib/nonce";
import { limits } from "@/lib/server-env";
import { Notice } from "@/components/empty-state";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: "Upload a template" };

export default async function UploadPage() {
  const viewer = await requireViewer("/upload");
  const l = limits();
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Upload a template</h1>
          <p className="mt-1 text-sm text-fg-muted">Add your files and a few screenshots, give it a title, and publish.</p>
        </div>
        <Link href="/rules" className="text-sm text-fg-muted underline hover:text-fg">What can I upload?</Link>
      </div>
      {viewer.profile.is_banned ? (
        <Notice tone="danger" title="Account suspended">You cannot upload while your account is suspended.</Notice>
      ) : (
        <UploadForm
          siteKey={publicEnv.turnstileSiteKey()}
          nonce={await getNonce()}
          maxFileBytes={l.maxTemplateFileBytes}
          maxFiles={l.maxFilesPerTemplate}
          maxShotBytes={l.maxScreenshotBytes}
          maxShots={l.maxScreenshotsPerTemplate}
        />
      )}
    </div>
  );
}
