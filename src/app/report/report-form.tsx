"use client";

import { useActionState, useState } from "react";
import { Turnstile } from "@/components/turnstile";
import { submitReport } from "./actions";

const KINDS = [
  ["malware", "Suspected malware or unsafe file"],
  ["copyright", "Copyright or ownership complaint"],
  ["abuse", "Abusive or illegal content"],
  ["spam", "Spam or misleading listing"],
  ["broken", "Broken or wrong file"],
  ["other", "Something else"],
] as const;

export function ReportForm({
  initialKind,
  template,
  siteKey,
  nonce,
  lockKind,
}: {
  initialKind: string;
  template: string;
  siteKey: string;
  nonce?: string;
  lockKind?: boolean;
}) {
  const [state, action, pending] = useActionState(submitReport, null);
  const [kind, setKind] = useState(initialKind);
  if (state?.ok) {
    return <p role="status" className="rounded-md border border-ok/40 bg-ok/5 px-4 py-3 text-sm text-ok">{state.message}</p>;
  }
  const copyright = kind === "copyright";
  return (
    <form action={action} className="space-y-4">
      {lockKind ? (
        <input type="hidden" name="kind" value={kind} />
      ) : (
        <div>
          <label htmlFor="kind" className="label">What is wrong?</label>
          <select id="kind" name="kind" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      )}
      <div>
        <label htmlFor="template" className="label">Listing address{copyright ? "" : " (optional)"}</label>
        <input id="template" name="template" defaultValue={template} placeholder="https://…/t/example-template or example-template" className="input" required={copyright} maxLength={300} />
      </div>
      {copyright ? (
        <>
          <div>
            <label htmlFor="claimant_name" className="label">Rights holder name</label>
            <input id="claimant_name" name="claimant_name" required maxLength={120} className="input" autoComplete="name" />
          </div>
          <div>
            <label htmlFor="original_work_url" className="label">Where the original work is published (optional)</label>
            <input id="original_work_url" name="original_work_url" type="url" maxLength={500} className="input" placeholder="https://" />
          </div>
        </>
      ) : null}
      <div>
        <label htmlFor="contact_email" className="label">Contact email{copyright ? "" : " (optional)"}</label>
        <input id="contact_email" name="contact_email" type="email" maxLength={254} required={copyright} className="input" autoComplete="email" />
        <p className="hint">Only moderators see it. We use it to ask follow-up questions.</p>
      </div>
      <div>
        <label htmlFor="details" className="label">Details</label>
        <textarea id="details" name="details" required minLength={10} maxLength={4000} rows={6} className="input h-auto py-2" placeholder={copyright ? "Describe the work you own and what was copied." : "What did you notice? For suspected malware, include your scanner's output."} />
      </div>
      {copyright ? (
        <label className="flex items-start gap-2 text-sm text-fg-muted">
          <input type="checkbox" name="good_faith" required className="mt-1 accent-[var(--color-accent)]" />
          <span>I believe in good faith that the use is not authorised by the rights holder, and the information in this complaint is accurate.</span>
        </label>
      ) : null}
      <Turnstile siteKey={siteKey} nonce={nonce} action="report" resetKey={state} />
      {state && !state.ok ? <p role="alert" className="text-sm text-danger">{state.message}</p> : null}
      <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Sending…" : copyright ? "Send complaint" : "Send report"}</button>
    </form>
  );
}
