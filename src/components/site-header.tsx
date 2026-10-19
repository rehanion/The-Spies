import Link from "next/link";
import { getViewer, isStaff } from "@/lib/auth";
import { previewUrl } from "@/lib/env";
import { Logo } from "@/components/logo";
import { PLATFORM_LABELS } from "@/lib/catalog";

export async function SiteHeader() {
  const viewer = await getViewer();
  const profile = viewer?.profile;
  const uploadHref = profile ? "/upload" : "/login?next=/upload";
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="shrink-0" aria-label="SPIES home">
          <Logo />
        </Link>
        <nav aria-label="Primary" className="ml-2 hidden items-center gap-1 text-sm lg:flex">
          <NavLink href="/">Home</NavLink>
          <NavLink href="/browse?sort=trending">Explore</NavLink>
          {profile ? <NavLink href="/feed">Following</NavLink> : null}
        </nav>
        <form action="/browse" method="get" role="search" className="mx-auto hidden w-full max-w-xl sm:flex">
          <label htmlFor="header-search" className="sr-only">Search templates</label>
          <input
            id="header-search"
            name="q"
            type="search"
            placeholder="Search templates, creators, tags"
            className="input h-10 rounded-l-full rounded-r-none border-r-0 px-4"
          />
          <button type="submit" className="btn btn-secondary h-10 rounded-l-none rounded-r-full px-4" aria-label="Search">
            <SearchIcon />
          </button>
        </form>
        <div className="ml-auto flex items-center gap-2 sm:ml-0">
          <Link href="/browse" className="btn btn-ghost h-9 w-9 rounded-full p-0 sm:hidden" aria-label="Search">
            <SearchIcon />
          </Link>
          <Link href={uploadHref} className="btn btn-secondary h-9 gap-1.5 rounded-full px-3" aria-label="Upload a template">
            <span aria-hidden="true" className="text-lg leading-none">＋</span>
            <span className="hidden sm:inline">Upload</span>
          </Link>
          {profile ? (
            <details className="relative">
              <summary className="flex h-9 cursor-pointer list-none items-center rounded-full [&::-webkit-details-marker]:hidden" aria-label="Account menu">
                <Avatar username={profile.username} avatarKey={profile.avatar_key} size={32} />
              </summary>
              <div className="pop-in absolute right-0 mt-2 w-60 origin-top-right overflow-hidden rounded-xl border border-line-strong bg-surface-2 py-1 text-sm shadow-xl">
                <div className="flex items-center gap-3 border-b border-line px-3 py-3">
                  <Avatar username={profile.username} avatarKey={profile.avatar_key} size={36} />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-fg">{profile.display_name || profile.username}</p>
                    <p className="truncate text-xs text-fg-subtle">@{profile.username}</p>
                  </div>
                </div>
                <MenuLink href={`/u/${profile.username}`}>Your channel</MenuLink>
                <MenuLink href="/dashboard">Your uploads</MenuLink>
                <MenuLink href="/feed">Following</MenuLink>
                <MenuLink href="/library">Saved &amp; history</MenuLink>
                <MenuLink href="/account">Settings</MenuLink>
                {isStaff(viewer) ? <MenuLink href="/admin">Admin</MenuLink> : null}
                <form action="/auth/signout" method="post" className="border-t border-line">
                  <button type="submit" className="w-full px-3 py-2 text-left text-fg-muted hover:bg-surface-3 hover:text-fg">
                    Sign out
                  </button>
                </form>
              </div>
            </details>
          ) : (
            <Link href="/login" className="btn btn-secondary h-9 rounded-full px-4">
              Sign in
            </Link>
          )}
        </div>
      </div>
      <nav aria-label="Mobile" className="flex gap-1 overflow-x-auto border-t border-line px-4 py-1.5 text-sm lg:hidden">
        <NavLink href="/">Home</NavLink>
        <NavLink href="/browse?sort=trending">Explore</NavLink>
        {profile ? <NavLink href="/feed">Following</NavLink> : null}
        {profile ? <NavLink href="/library">Saved</NavLink> : null}
        {Object.entries(PLATFORM_LABELS).map(([id, label]) => (
          <NavLink key={id} href={`/browse?platform=${id}`}>{label}</NavLink>
        ))}
      </nav>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="shrink-0 rounded-lg px-3 py-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg">
      {children}
    </Link>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function MenuLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="block px-3 py-2 text-fg-muted hover:bg-surface-3 hover:text-fg">
      {children}
    </Link>
  );
}

export function Avatar({ username, avatarKey, size = 32 }: { username: string; avatarKey: string | null; size?: number }) {
  const src = previewUrl(avatarKey);
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      aria-hidden="true"
      className="inline-flex items-center justify-center rounded-full bg-surface-3 font-mono font-semibold uppercase text-fg-muted"
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.42) }}
    >
      {username.slice(0, 1)}
    </span>
  );
}
