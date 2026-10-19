import type { Metadata } from "next";
import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { searchTemplates } from "@/lib/data/templates";
import { createClient } from "@/lib/supabase/server";
import { TemplateGrid } from "@/components/template-card";
import { Pagination } from "@/components/pagination";
import { EmptyState } from "@/components/empty-state";
import { Avatar } from "@/components/site-header";

export const metadata: Metadata = { title: "Following" };

export default async function FeedPage({ searchParams }: PageProps<"/feed">) {
  const viewer = await requireViewer("/feed");
  const sp = await searchParams;
  const page = Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1;
  const supabase = await createClient();
  const [{ data: follows }, result] = await Promise.all([
    supabase
      .from("follows")
      .select("creator:profiles!follows_creator_id_fkey(username, display_name, avatar_key)")
      .eq("follower_id", viewer.userId)
      .order("created_at", { ascending: false })
      .limit(50),
    searchTemplates({ following: true, sort: "recent", page }),
  ]);
  const creators = (follows ?? []).map((f) => f.creator as unknown as { username: string; display_name: string; avatar_key: string | null }).filter(Boolean);

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-semibold text-fg">Following</h1>
      {creators.length ? (
        <ul className="-mx-4 mt-4 flex gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          {creators.map((c) => (
            <li key={c.username}>
              <Link href={`/u/${c.username}`} className="flex w-20 flex-col items-center gap-1 text-center">
                <Avatar username={c.username} avatarKey={c.avatar_key} size={56} />
                <span className="w-full truncate text-xs text-fg-muted">{c.display_name || c.username}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-6">
        {result.items.length ? (
          <>
            <TemplateGrid items={result.items} />
            <Pagination page={result.page} pageCount={result.pageCount} makeHref={(p) => `/feed${p > 1 ? `?page=${p}` : ""}`} />
          </>
        ) : (
          <EmptyState title={creators.length ? "No uploads from your creators yet" : "You are not following anyone yet"} action={<Link href="/browse?sort=trending" className="btn btn-primary rounded-full px-5">Find creators</Link>}>
            Follow creators from their channel or template pages and their new uploads show up here.
          </EmptyState>
        )}
      </div>
    </div>
  );
}
