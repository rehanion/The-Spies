import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { ReportResolveForm } from "@/components/admin/forms";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  const sp = await searchParams;
  const status = sp.status === "resolved" || sp.status === "dismissed" ? sp.status : "open";
  const supabase = await createClient();
  const { data: reports } = await supabase
    .from("reports")
    .select("*, template:templates(id, title, slug, publication_status)")
    .eq("status", status)
    .order("created_at", { ascending: status === "open" })
    .limit(200);
  return (
    <div>
      <div className="mb-4 flex gap-2 text-sm">
        {(["open", "resolved", "dismissed"] as const).map((s) => (
          <Link key={s} href={`/admin/reports?status=${s}`} aria-current={s === status ? "page" : undefined} className={`rounded px-2.5 py-1 ${s === status ? "bg-surface-3 text-fg" : "text-fg-muted hover:text-fg"}`}>{s}</Link>
        ))}
      </div>
      {reports?.length ? (
        <ul className="space-y-3">
          {reports.map((r) => {
            const t = r.template as unknown as { id: string; title: string; slug: string; publication_status: string } | null;
            return (
              <li key={r.id} className="card p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={r.kind === "copyright" || r.kind === "malware" ? "danger" : "warn"}>{r.kind}</Badge>
                  {t ? <Link href={`/admin/submissions/${t.id}`} className="font-medium text-fg hover:text-accent">{t.title}</Link> : <span className="text-fg-subtle">{r.template_slug ?? "No listing"}</span>}
                  {t ? <span className="text-xs text-fg-subtle">({t.publication_status})</span> : null}
                  <span className="ml-auto text-xs text-fg-subtle">{formatDateTime(r.created_at)}</span>
                </div>
                <p className="prose-plain mt-2">{r.details}</p>
                {r.kind === "copyright" ? (
                  <dl className="mt-2 grid gap-x-3 text-xs sm:grid-cols-[max-content_1fr]">
                    <dt className="text-fg-subtle">Claimant</dt><dd>{r.claimant_name}</dd>
                    <dt className="text-fg-subtle">Contact</dt><dd>{r.contact_email}</dd>
                    <dt className="text-fg-subtle">Original work</dt><dd className="break-all">{r.original_work_url}</dd>
                    <dt className="text-fg-subtle">Good-faith statement</dt><dd>{r.good_faith_statement ? "yes" : "no"}</dd>
                  </dl>
                ) : r.contact_email ? <p className="mt-1 text-xs text-fg-subtle">Contact: {r.contact_email}</p> : null}
                {r.status === "open" ? <ReportResolveForm reportId={r.id} /> : <p className="mt-2 text-xs text-fg-subtle">{r.status} {formatDateTime(r.resolved_at)} {r.resolution_note ? `· ${r.resolution_note}` : ""}</p>}
                {t && r.status === "open" ? <p className="mt-2 text-xs text-fg-subtle">To take content down, open the listing and use <strong>Remove</strong>.</p> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title={`No ${status} reports`} />
      )}
    </div>
  );
}
