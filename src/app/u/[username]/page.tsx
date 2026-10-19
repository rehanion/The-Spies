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
import { FollowButton } from "@/components/follow-button";
import { getViewer } from "@/lib/auth";

const getProfile = cache(async (username: string) => {
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, username, display_name, bio, avatar_key, role, is_banned, is_demo, created_at, follower_count")
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
  const [profile, viewer, sp] = await Promise.all([getProfile((await params).username), getViewer(), searchParams]);
  if (!profile || profile.is_banned) notFound();
  const page = Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1;
  const sort = sp.sort === "popular" ? "views" : "recent";
  const supabase = await createClient();
  const [result, follow] = await Promise.all([
    searchTemplates({ creatorId: profile.id, sort, page, pageSize: 12 }),
    viewer ? supabase.from("follows").select("creator_id").eq("follower_id", viewer.userId).eq("creator_id", profile.id).maybeSingle() : null,
  ]);
  const base = `/u/${profile.username}`;
  const tabHref = (s: string) => (s === "recent" ? base : `${base}?sort=popular`);

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
      <div className="h-28 rounded-2xl bg-gradient-to-r from-surface-3 via-surface-2 to-accent/20 sm:h-40" aria-hidden="true" />
      <header className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
        <Avatar username={profile.username} avatarKey={profile.avatar_key} size={96} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-fg sm:text-3xl">{profile.display_name || profile.username}</h1>
            {profile.role !== "user" ? <Badge tone="accent">{profile.role === "admin" ? "Admin" : "Moderator"}</Badge> : null}
            {profile.is_demo ? <DemoBadge /> : null}
          </div>
          <p className="mt-1 text-sm text-fg-muted">
            @{profile.username} · {formatCount(result.total)} template{result.total === 1 ? "" : "s"} · joined {formatDate(profile.created_at)}
          </p>
          {profile.bio ? <p className="mt-2 line-clamp-3 max-w-2xl whitespace-pre-line text-sm text-fg-muted">{profile.bio}</p> : null}
          <div className="mt-3">
            <FollowButton
              creatorId={profile.id}
              initialFollowing={!!follow?.data}
              initialCount={profile.follower_count}
              signedIn={!!viewer}
              isSelf={viewer?.userId === profile.id}
              nextPath={base}
            />
          </div>
        </div>
        {viewer?.userId === profile.id ? (
          <div className="flex gap-2">
            <Link href="/account" className="btn btn-secondary rounded-full">Customize channel</Link>
            <Link href="/dashboard" className="btn btn-secondary rounded-full">Manage uploads</Link>
          </div>
        ) : null}
      </header>

      <nav aria-label="Sort templates" className="mt-6 flex gap-2 border-b border-line">
        {[["recent", "Latest"], ["views", "Popular"]].map(([key, label]) => (
          <Link
            key={key}
            href={tabHref(key)}
            aria-current={sort === key ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${sort === key ? "border-fg text-fg" : "border-transparent text-fg-muted hover:text-fg"}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      <section className="mt-6" aria-label="Templates">
        {result.items.length ? (
          <>
            <TemplateGrid items={result.items} />
            <Pagination page={result.page} pageCount={result.pageCount} makeHref={(p) => `${tabHref(sort)}${p > 1 ? `${sort === "views" ? "&" : "?"}page=${p}` : ""}`} />
          </>
        ) : (
          <EmptyState title="No templates yet" action={viewer?.userId === profile.id ? <Link href="/upload" className="btn btn-primary rounded-full px-5">Upload your first template</Link> : <Link href="/browse" className="btn btn-secondary rounded-full">Explore templates</Link>} />
        )}
      </section>
    </div>
  );
}
