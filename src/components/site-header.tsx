import Link from "next/link";
import { getViewer, isStaff } from "@/lib/auth";
import { previewUrl } from "@/lib/env";
import { Logo } from "@/components/logo";
import { PLATFORM_LABELS } from "@/lib/catalog";

export async function SiteHeader() {
  const viewer = await getViewer();
  const profile = viewer?.profile;
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="shrink-0" aria-label="SPIES home">
          <Logo />
        </Link>
        <nav aria-label="Primary" className="ml-4 hidden items-center gap-1 text-sm md:flex">
          <Link href="/browse" className="rounded px-2.5 py-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg">
            Browse
          </Link>
          {Object.entries(PLATFORM_LABELS).map(([id, label]) => (
            <Link
              key={id}
              href={`/browse?platform=${id}`}
              className="rounded px-2.5 py-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
              {label}
            </Link>
          ))}
        </nav>
        <form action="/browse" method="get" role="search" className="ml-auto hidden max-w-xs flex-1 sm:block">
          <label htmlFor="header-search" className="sr-only">
            Search templates
          </label>
          <input
            id="header-search"
            name="q"
            type="search"
            placeholder="Search templates, creators, tags"
            className="input h-9 py-1.5"
          />
        </form>
        <div className="ml-auto flex items-center gap-2 sm:ml-2">
          {profile ? (
            <>
              <Link href="/dashboard/new" className="btn btn-primary hidden h-9 sm:inline-flex">
                Upload
              </Link>
              <details className="relative">
                <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-line-strong bg-surface-2 px-2 text-sm text-fg hover:bg-surface-3 [&::-webkit-details-marker]:hidden">
                  <Avatar username={profile.username} avatarKey={profile.avatar_key} size={22} />
                  <span className="hidden max-w-[10rem] truncate sm:inline">{profile.username}</span>
                </summary>
                <div className="absolute right-0 mt-2 w-52 overflow-hidden rounded-md border border-line-strong bg-surface-2 py-1 text-sm shadow-xl">
                  <MenuLink href={`/u/${profile.username}`}>Public profile</MenuLink>
                  <MenuLink href="/dashboard">Creator dashboard</MenuLink>
                  <MenuLink href="/dashboard/new">Upload a template</MenuLink>
                  <MenuLink href="/library">Library &amp; favorites</MenuLink>
                  <MenuLink href="/account">Account settings</MenuLink>
                  {isStaff(viewer) ? <MenuLink href="/admin">Admin</MenuLink> : null}
                  <form action="/auth/signout" method="post" className="border-t border-line">
                    <button type="submit" className="w-full px-3 py-2 text-left text-fg-muted hover:bg-surface-3 hover:text-fg">
                      Sign out
                    </button>
                  </form>
                </div>
              </details>
            </>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost h-9">
                Sign in
              </Link>
              <Link href="/signup" className="btn btn-secondary h-9">
                Create account
              </Link>
            </>
          )}
        </div>
      </div>
      <nav aria-label="Mobile" className="flex gap-1 overflow-x-auto border-t border-line px-4 py-1.5 text-sm md:hidden">
        <Link href="/browse" className="shrink-0 rounded px-2 py-1 text-fg-muted hover:text-fg">
          Browse
        </Link>
        {Object.entries(PLATFORM_LABELS).map(([id, label]) => (
          <Link key={id} href={`/browse?platform=${id}`} className="shrink-0 rounded px-2 py-1 text-fg-muted hover:text-fg">
            {label}
          </Link>
        ))}
        {profile ? (
          <Link href="/dashboard/new" className="shrink-0 rounded px-2 py-1 text-accent">
            Upload
          </Link>
        ) : null}
      </nav>
    </header>
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
