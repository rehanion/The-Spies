import type { Metadata } from "next";
import Link from "next/link";
import { getViewer, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/badges";
import { UserControls } from "@/components/admin/forms";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24) : "";
  const viewer = await getViewer();
  const supabase = await createClient();
  let query = supabase.from("profiles").select("id, username, display_name, role, is_banned, is_demo, created_at").order("created_at", { ascending: false }).limit(100);
  if (q) query = query.ilike("username", `%${q}%`);
  const { data: users } = await query;
  return (
    <div>
      <form className="mb-4 flex max-w-sm gap-2" role="search">
        <label htmlFor="uq" className="sr-only">Search usernames</label>
        <input id="uq" name="q" defaultValue={q} placeholder="Search username" className="input" />
        <button className="btn btn-secondary">Search</button>
      </form>
      <ul className="card divide-y divide-line">
        {(users ?? []).map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <Link href={`/u/${u.username}`} className="font-medium text-fg hover:text-accent">@{u.username}</Link>
            <span className="text-xs text-fg-subtle">joined {formatDate(u.created_at)}</span>
            {u.role !== "user" ? <Badge tone="accent">{u.role}</Badge> : null}
            {u.is_banned ? <Badge tone="danger">suspended</Badge> : null}
            {u.is_demo ? <Badge tone="info">demo</Badge> : null}
            <div className="ml-auto">
              {u.id !== viewer?.userId ? <UserControls userId={u.id} role={u.role} banned={u.is_banned} viewerIsAdmin={isAdmin(viewer)} /> : <span className="text-xs text-fg-subtle">you</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
