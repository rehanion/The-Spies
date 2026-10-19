"use client";

import { useActionState } from "react";
import { CATEGORY_LABELS, LICENSES, PLATFORM_LABELS } from "@/lib/catalog";
import type { FormState } from "@/app/dashboard/actions";
import { Turnstile } from "@/components/turnstile";

export interface MetadataValues {
  id?: string;
  title: string;
  summary: string;
  description: string;
  platform_id: string;
  platform_version: string;
  category_id: string;
  tags: string[];
  dependencies: string;
  install_steps: string;
  license_code: string;
  license_text: string;
  rights_attested: boolean;
}

export const EMPTY_METADATA: MetadataValues = {
  title: "",
  summary: "",
  description: "",
  platform_id: "",
  platform_version: "",
  category_id: "",
  tags: [],
  dependencies: "",
  install_steps: "",
  license_code: "free-personal",
  license_text: "",
  rights_attested: false,
};

function FieldError({ name, state }: { name: string; state: FormState }) {
  const msg = state?.fieldErrors?.[name];
  return msg ? (
    <p id={`${name}-error`} className="mt-1 text-xs text-danger">
      {msg}
    </p>
  ) : null;
}

export function MetadataForm({
  action,
  values,
  submitLabel,
  turnstile,
  platformHints,
}: {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  values: MetadataValues;
  submitLabel: string;
  turnstile?: { siteKey: string; nonce?: string };
  platformHints: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const invalid = (name: string) => (state?.fieldErrors?.[name] ? { "aria-invalid": true, "aria-describedby": `${name}-error` } : {});
  return (
    <form action={formAction} className="space-y-6">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="title" className="label">Title</label>
          <input id="title" name="title" required minLength={3} maxLength={120} defaultValue={values.title} className="input" {...invalid("title")} />
          <FieldError name="title" state={state} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="summary" className="label">Short summary</label>
          <input id="summary" name="summary" maxLength={280} defaultValue={values.summary} className="input" placeholder="One line shown on cards and search results" />
          <FieldError name="summary" state={state} />
        </div>
        <div>
          <label htmlFor="platform_id" className="label">Platform</label>
          <select id="platform_id" name="platform_id" required defaultValue={values.platform_id} className="input" {...invalid("platform_id")}>
            <option value="" disabled>Choose a platform</option>
            {Object.entries(PLATFORM_LABELS).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
          <p className="hint">
            Accepted files:{" "}
            {Object.entries(platformHints).map(([id, hint]) => (
              <span key={id} className="block">{PLATFORM_LABELS[id]}: {hint}</span>
            ))}
          </p>
          <FieldError name="platform_id" state={state} />
        </div>
        <div>
          <label htmlFor="platform_version" className="label">Compatible platform version</label>
          <input id="platform_version" name="platform_version" maxLength={60} defaultValue={values.platform_version} className="input" placeholder="e.g. 7.0.12, version 2650+, 1.140" />
        </div>
        <div>
          <label htmlFor="category_id" className="label">Category</label>
          <select id="category_id" name="category_id" required defaultValue={values.category_id} className="input" {...invalid("category_id")}>
            <option value="" disabled>Choose a category</option>
            {Object.entries(CATEGORY_LABELS).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
          <FieldError name="category_id" state={state} />
        </div>
        <div>
          <label htmlFor="tags" className="label">Tags</label>
          <input id="tags" name="tags" maxLength={400} defaultValue={values.tags.join(", ")} className="input" placeholder="es, footprint, imbalance" />
          <p className="hint">Comma separated, up to 10.</p>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="description" className="label">Description</label>
          <textarea id="description" name="description" rows={7} maxLength={10000} defaultValue={values.description} className="input" placeholder="What does this setup show? Which markets and timeframes is it built for?" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="install_steps" className="label">Installation steps</label>
          <textarea id="install_steps" name="install_steps" rows={5} maxLength={5000} defaultValue={values.install_steps} className="input" placeholder={"1. In Sierra Chart open File > Open Chartbook…\n2. …"} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="dependencies" className="label">Dependencies</label>
          <textarea id="dependencies" name="dependencies" rows={2} maxLength={2000} defaultValue={values.dependencies} className="input" placeholder="Data feed requirements, built in studies, other templates…" />
        </div>
        <div>
          <label htmlFor="license_code" className="label">License</label>
          <select id="license_code" name="license_code" defaultValue={values.license_code} className="input">
            {Object.entries(LICENSES).map(([id, l]) => (
              <option key={id} value={id}>{l.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="license_text" className="label">License details <span className="font-normal text-fg-subtle">(required for custom)</span></label>
          <textarea id="license_text" name="license_text" rows={2} maxLength={3000} defaultValue={values.license_text} className="input" {...invalid("license_text")} />
          <FieldError name="license_text" state={state} />
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm text-fg-muted">
        <input type="checkbox" name="rights_attested" defaultChecked={values.rights_attested} required className="mt-1 accent-[var(--color-accent)]" />
        <span>
          I created these files or have permission to share them under the license above. They contain no account
          credentials, licence keys or personal data, and no executable code.
        </span>
      </label>
      <FieldError name="rights_attested" state={state} />
      {turnstile ? <Turnstile siteKey={turnstile.siteKey} nonce={turnstile.nonce} action="create-submission" resetKey={state} /> : null}
      {state ? (
        <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-ok" : "text-danger"}`}>{state.message}</p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : submitLabel}</button>
    </form>
  );
}
