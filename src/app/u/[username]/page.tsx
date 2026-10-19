import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { searchTemplates } from "@/lib/data/templates";
import { createClient } from "@/lib/supabase/server";
import { formatCount, formatDate } from "@/lib/format";
import { Avatar } from "@/components/site-header";
import { Badge, DemoBadge } from "@/components/badges";
import { TemplateGrid } from "@/components/template-card";
import { Pagination } from "@/components/pagination";
import { EmptyState } from "@/components/empty-state";

const getProfile = cache(async (username: string) => {
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, username, display_name, bio, avatar_key, role, is_banned, is_demo, created_at")
    .eq("username", username)
    .maybeSingle();
  return data;
});

export async function generateMetadata({ params }: PageProps<"/u/[username]">): Promise<Metadata> {
  const p = await getProfile((await params).username);
  if (!p || p.is_banned) return { title: "Creator not found" };
  return { title: `${p.display_name || p.username} (@${p.username})`, description: p.bio.slice(0, 160) || undefined };
}

export default async function CreatorPage({ params, searchParams }: PageProps<"/u/[username]">) {
  const profile = await getProfile((await params).username);
  if (!profile || profile.is_banned) notFound();
  const sp = await searchParams;
  const page = Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1;
  const result = await searchTemplates({ creatorId: profile.id, sort: "recent", page, pageSize: 12 });
  const downloads = result.items.reduce((n, t) => n + t.download_count, 0);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <header className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
        <Avatar username={profile.username} avatarKey={profile.avatar_key} size={72} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-fg">{profile.display_name || profile.username}</h1>
            {profile.role !== "user" ? <Badge tone="accent">{profile.role === "admin" ? "Admin" : "Moderator"}</Badge> : null}
            {profile.is_demo ? <DemoBadge /> : null}
          </div>
          <p className="text-sm text-fg-subtle">@{profile.username} · joined {formatDate(profile.created_at)}</p>
          {profile.bio ? <p className="prose-plain mt-3 max-w-2xl whitespace-pre-line text-sm text-fg-muted">{profile.bio}</p> : null}
        </div>
        <dl className="flex gap-6 text-sm">
          <div>
            <dt className="text-xs text-fg-subtle">Templates</dt>
            <dd className="font-mono text-lg text-fg">{formatCount(result.total)}</dd>
          </div>
          {result.pageCount === 1 ? (
            <div>
              <dt className="text-xs text-fg-subtle">Downloads</dt>
              <dd className="font-mono text-lg text-fg">{formatCount(downloads)}</dd>
            </div>
          ) : null}
        </dl>
      </header>

      <section className="mt-8" aria-labelledby="tpl-h">
        <h2 id="tpl-h" className="mb-4 text-lg font-semibold text-fg">Published templates</h2>
        {result.items.length ? (
          <>
            <TemplateGrid items={result.items} />
            <Pagination page={result.page} pageCount={result.pageCount} makeHref={(p) => `/u/${profile.username}${p > 1 ? `?page=${p}` : ""}`} />
          </>
        ) : (
          <EmptyState title="No published templates yet" action={<Link href="/browse" className="btn btn-secondary">Browse all templates</Link>} />
        )}
      </section>
    </div>
  );
}
