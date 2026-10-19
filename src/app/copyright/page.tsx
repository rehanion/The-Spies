import type { Metadata } from "next";
import { publicEnv } from "@/lib/env";
import { getNonce } from "@/lib/nonce";
import { ReportForm } from "@/app/report/report-form";

export const metadata: Metadata = { title: "Copyright complaints" };

export default async function CopyrightPage({ searchParams }: PageProps<"/copyright">) {
  const sp = await searchParams;
  const template = typeof sp.template === "string" && /^[a-z0-9-]{1,96}$/.test(sp.template) ? sp.template : "";
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-fg">Copyright complaints</h1>
      <div className="prose-plain mt-3 space-y-3 text-sm text-fg-muted">
        <p>
          Uploaders must confirm they have the right to share every file. If you believe a listing copies your work without permission, use this form.
          Moderators review every complaint. While a complaint is assessed the listing may be removed from public view.
        </p>
        <p>What happens next:</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>A moderator checks the listing against the information you give.</li>
          <li>If the claim is plausible, the listing is removed and its files can no longer be downloaded.</li>
          <li>The uploader can respond through the moderators. Repeated infringement leads to account suspension.</li>
        </ol>
        <p>Knowingly false complaints are themselves a violation of the rules.</p>
      </div>
      <div className="card mt-6 p-5">
        <ReportForm initialKind="copyright" lockKind template={template} siteKey={publicEnv.turnstileSiteKey()} nonce={await getNonce()} />
      </div>
    </div>
  );
}
