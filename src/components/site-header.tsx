import Link from "next/link";
import { DISCORD_INVITE } from "@/lib/links";
import { getViewer, isStaff } from "@/lib/auth";
import { previewUrl } from "@/lib/env";
import { Logo } from "@/components/logo";
import { getCatalog } from "@/lib/data/catalog";

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
          <a href={DISCORD_INVITE} target="_blank" rel="noopener noreferrer" className="btn btn-ghost h-9 w-9 rounded-full p-0" aria-label="Join our Discord" title="Join our Discord">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-current">
              <path d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.45.87-.61 1.25a18.3 18.3 0 0 0-5.49 0 12.6 12.6 0 0 0-.62-1.25.08.08 0 0 0-.08-.04 19.7 19.7 0 0 0-4.89 1.52.07.07 0 0 0-.03.03C.53 9.05-.32 13.58.1 18.06a.08.08 0 0 0 .03.06 19.9 19.9 0 0 0 5.99 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.23-2a.08.08 0 0 0-.04-.1 13.1 13.1 0 0 1-1.87-.9.08.08 0 0 1-.01-.13l.37-.29a.07.07 0 0 1 .08-.01c3.93 1.8 8.18 1.8 12.07 0a.07.07 0 0 1 .08.01l.37.29a.08.08 0 0 1-.01.13c-.6.35-1.22.65-1.87.9a.08.08 0 0 0-.04.1c.36.7.77 1.37 1.22 2a.08.08 0 0 0 .08.03 19.8 19.8 0 0 0 6-3.03.08.08 0 0 0 .03-.05c.5-5.18-.84-9.67-3.55-13.66a.06.06 0 0 0-.03-.03ZM8.02 15.33c-1.18 0-2.16-1.09-2.16-2.42s.96-2.42 2.16-2.42c1.21 0 2.18 1.1 2.16 2.42 0 1.33-.96 2.42-2.16 2.42Zm7.97 0c-1.18 0-2.15-1.09-2.15-2.42s.95-2.42 2.15-2.42c1.21 0 2.18 1.1 2.16 2.42 0 1.33-.95 2.42-2.16 2.42Z" />
            </svg>
          </a>
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
        {(await getCatalog()).platforms.map((x) => (
          <NavLink key={x.id} href={`/browse?platform=${x.id}`}>{x.name}</NavLink>
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
