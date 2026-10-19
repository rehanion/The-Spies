import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  const sp = await searchParams;
  const before = typeof sp.before === "string" && /^\d+$/.test(sp.before) ? Number(sp.before) : null;
  const supabase = await createClient();
  let query = supabase.from("moderation_events").select("*").order("id", { ascending: false }).limit(100);
  if (before) query = query.lt("id", before);
  const { data: events, error } = await query;
  const rows = events ?? [];
  // The audit log keeps no FK to profiles so entries survive account deletion; resolve names separately.
  const actorIds = [...new Set(rows.map((e) => e.actor_id).filter((v): v is string => !!v))];
  const { data: actors } = actorIds.length ? await supabase.from("profiles").select("id, username").in("id", actorIds) : { data: [] };
  const names = new Map((actors ?? []).map((a) => [a.id, a.username]));
  return (
    <div>
      {error ? <p className="text-sm text-danger">{error.message}</p> : null}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="border-b border-line text-fg-subtle">
            <tr><th className="px-3 py-2">Time (UTC)</th><th className="px-3 py-2">Actor</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Listing</th><th className="px-3 py-2">Details</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((e) => (
              <tr key={e.id} className="align-top">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-fg-subtle">{formatDateTime(e.created_at)}</td>
                <td className="px-3 py-2">{e.actor_id ? names.get(e.actor_id) ?? "deleted user" : "system"}</td>
                <td className="px-3 py-2 font-mono text-fg">{e.action}</td>
                <td className="px-3 py-2">{e.template_id ? <Link className="underline" href={`/admin/submissions/${e.template_id}`}>open</Link> : "None"}</td>
                <td className="max-w-md break-all px-3 py-2 font-mono text-fg-subtle">{JSON.stringify(e.details)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 100 ? <Link className="btn btn-ghost mt-3" href={`/admin/audit?before=${rows[rows.length - 1].id}`}>Older →</Link> : null}
    </div>
  );
}
