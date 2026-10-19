import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { limits, serverEnv } from "@/lib/server-env";
import { publicEnv } from "@/lib/env";
import { formatBytes, formatDateTime } from "@/lib/format";
import { CleanupButton } from "@/components/admin/forms";

export const metadata: Metadata = { title: "Admin overview" };

async function processorHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${serverEnv.functionsUrl()}/process-upload`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-processor-secret": serverEnv.processorSecret() },
      body: JSON.stringify({ kind: "health" }),
    });
    if (res.status === 400) return { ok: true, detail: "Reachable, secret accepted" };
    if (res.status === 401) return { ok: false, detail: "Secret rejected: PROCESSOR_SECRET differs between app and function" };
    return { ok: false, detail: `Unexpected HTTP ${res.status}` };
  } catch {
    return { ok: false, detail: "Unreachable: deploy the process-upload Edge Function" };
  }
}

export default async function AdminOverview() {
  const admin = createAdminClient();
  const supabase = await createClient();
  const [usage, processor, events] = await Promise.all([
    admin.rpc("storage_usage"),
    processorHealth(),
    supabase.from("moderation_events").select("id, action, template_id, created_at, details").order("created_at", { ascending: false }).limit(10),
  ]);
  const u = usage.data?.[0];
  const l = limits();
  const pct = u ? Math.round((u.total_bytes / l.platformStorageSoftLimitBytes) * 100) : 0;
  const turnstileOk = !!publicEnv.turnstileSiteKey() && !!serverEnv.turnstileSecret();

  const health: { label: string; ok: boolean; detail: string }[] = [
    { label: "Database", ok: !usage.error, detail: usage.error ? usage.error.message : "Queries succeed" },
    { label: "Upload processor (Edge Function)", ...processor },
    { label: "Turnstile bot protection", ok: turnstileOk, detail: turnstileOk ? "Site key and secret configured" : serverEnv.turnstileDisabled() ? "DISABLED (development mode)" : "Not configured: protected forms will refuse submissions" },
    { label: "Uploads", ok: !serverEnv.uploadsPaused() && pct < 100, detail: serverEnv.uploadsPaused() ? "Paused by UPLOADS_PAUSED" : pct >= 100 ? "Storage allowance reached; uploads refused" : "Accepting uploads" },
    { label: "Downloads require login", ok: true, detail: serverEnv.downloadRequiresLogin() ? "Yes" : "No (anonymous downloads allowed)" },
  ];

  return (
    <div className="space-y-8">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/admin/queue" className="card p-4 hover:border-line-strong">
          <p className="text-xs text-fg-subtle">Listings awaiting review</p>
          <p className="mt-1 font-mono text-2xl text-fg">{u?.pending_review_count ?? "—"}</p>
        </Link>
        <Link href="/admin/queue#scan" className="card p-4 hover:border-line-strong">
          <p className="text-xs text-fg-subtle">Files awaiting a scan</p>
          <p className="mt-1 font-mono text-2xl text-fg">{u?.pending_scan_count ?? "—"}</p>
        </Link>
        <Link href="/admin/reports" className="card p-4 hover:border-line-strong">
          <p className="text-xs text-fg-subtle">Open reports</p>
          <p className="mt-1 font-mono text-2xl text-fg">{u?.open_report_count ?? "—"}</p>
        </Link>
        <div className="card p-4">
          <p className="text-xs text-fg-subtle">Storage used (app allowance)</p>
          <p className="mt-1 font-mono text-2xl text-fg">{pct}%</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded bg-surface-3" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Storage used">
            <div className={`h-full ${pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-warn" : "bg-ok"}`} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <p className="mt-1 text-xs text-fg-subtle">{formatBytes(u?.total_bytes ?? 0)} of {formatBytes(l.platformStorageSoftLimitBytes)} (files {formatBytes(u?.file_bytes ?? 0)}, images {formatBytes(u?.screenshot_bytes ?? 0)})</p>
        </div>
      </section>

      <section aria-labelledby="health-h">
        <h2 id="health-h" className="mb-3 text-base font-semibold text-fg">Operational health</h2>
        <ul className="card divide-y divide-line">
          {health.map((h) => (
            <li key={h.label} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${h.ok ? "bg-ok" : "bg-danger"}`} />
              <span className="font-medium text-fg">{h.label}</span>
              <span className="text-fg-muted">{h.detail}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-fg-subtle">
          Provider quotas (Supabase Free: 1 GB storage, 500 MB database, 5 GB egress; Cloudflare Workers Free: 100,000 requests/day) are not visible from here. Check the Supabase and Cloudflare dashboards weekly.
        </p>
      </section>

      <section aria-labelledby="maint-h">
        <h2 id="maint-h" className="mb-3 text-base font-semibold text-fg">Maintenance</h2>
        <div className="card p-4">
          <p className="mb-3 text-sm text-fg-muted">Upload reservations that never completed within 24 hours still count against quotas. Clean them up periodically.</p>
          <CleanupButton />
        </div>
      </section>

      <section aria-labelledby="recent-h">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="recent-h" className="text-base font-semibold text-fg">Recent audit events</h2>
          <Link className="text-sm text-fg-muted hover:text-accent" href="/admin/audit">Full log →</Link>
        </div>
        <ul className="card divide-y divide-line text-sm">
          {(events.data ?? []).map((e) => (
            <li key={e.id} className="flex flex-wrap gap-3 px-4 py-2">
              <span className="font-mono text-xs text-fg-subtle">{formatDateTime(e.created_at)}</span>
              <span className="font-mono text-xs text-fg">{e.action}</span>
              {e.template_id ? <Link className="text-xs text-fg-muted underline" href={`/admin/submissions/${e.template_id}`}>listing</Link> : null}
            </li>
          ))}
          {events.data?.length ? null : <li className="px-4 py-3 text-fg-subtle">No events yet.</li>}
        </ul>
      </section>
    </div>
  );
}
