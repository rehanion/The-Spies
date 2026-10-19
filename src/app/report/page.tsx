import type { Metadata } from "next";
import { publicEnv } from "@/lib/env";
import { getNonce } from "@/lib/nonce";
import { ReportForm } from "./report-form";

export const metadata: Metadata = { title: "Report a problem" };

const KINDS = new Set(["abuse", "malware", "copyright", "spam", "broken", "other"]);

export default async function ReportPage({ searchParams }: PageProps<"/report">) {
  const sp = await searchParams;
  const template = typeof sp.template === "string" && /^[a-z0-9-]{1,96}$/.test(sp.template) ? sp.template : "";
  const comment = typeof sp.comment === "string" && /^[0-9a-f-]{36}$/.test(sp.comment) ? sp.comment : undefined;
  const kind = typeof sp.kind === "string" && KINDS.has(sp.kind) ? sp.kind : "malware";
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-fg">Report a problem</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Reports go to the moderators. If a file looks dangerous, do not open it; tell us what your scanner found instead. You do not need an account to report.
      </p>
      <div className="card mt-6 p-5">
        <ReportForm initialKind={kind} template={template} comment={comment} siteKey={publicEnv.turnstileSiteKey()} nonce={await getNonce()} />
      </div>
    </div>
  );
}
