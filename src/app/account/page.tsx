import type { Metadata } from "next";
import Link from "next/link";
import { Avatar } from "@/components/site-header";
import { Notice } from "@/components/empty-state";
import { requireViewer } from "@/lib/auth";
import { formatBytes, formatDate } from "@/lib/format";
import { limits } from "@/lib/server-env";
import { createAdminClient } from "@/lib/supabase/admin";
import { AvatarForm, EmailForm, ProfileForm } from "./account-forms";

export const metadata: Metadata = { title: "Account settings" };

export default async function AccountPage() {
  const viewer = await requireViewer("/account");
  const p = viewer.profile;
  const l = limits();
  const { data: used } = await createAdminClient().rpc("user_storage_usage", { p_user_id: viewer.userId });
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <header className="flex items-center gap-4">
        <Avatar username={p.username} avatarKey={p.avatar_key} size={56} />
        <div>
          <h1 className="text-2xl font-semibold text-fg">Account settings</h1>
          <p className="text-sm text-fg-muted">
            Member since {formatDate(p.created_at)} · <Link href={`/u/${p.username}`} className="underline">View public profile</Link>
          </p>
        </div>
      </header>
      {p.is_banned ? <Notice tone="danger" title="Account suspended">You can still sign in, but you cannot upload, review or report. Contact the administrators if you think this is a mistake.</Notice> : null}

      <section className="card space-y-4 p-5" aria-labelledby="profile-h">
        <h2 id="profile-h" className="text-lg font-semibold text-fg">Public profile</h2>
        <ProfileForm username={p.username} displayName={p.display_name} bio={p.bio} />
      </section>

      <section className="card space-y-4 p-5" aria-labelledby="avatar-h">
        <h2 id="avatar-h" className="text-lg font-semibold text-fg">Avatar</h2>
        <AvatarForm hasAvatar={!!p.avatar_key} maxBytes={l.maxAvatarBytes} />
      </section>

      <section className="card space-y-4 p-5" aria-labelledby="signin-h">
        <h2 id="signin-h" className="text-lg font-semibold text-fg">Sign-in</h2>
        <EmailForm email={viewer.email ?? ""} />
        <p className="text-sm text-fg-muted">
          To change your password, <Link href="/reset-password" className="underline">set a new password</Link> while signed in.
        </p>
      </section>

      <section className="card space-y-2 p-5" aria-labelledby="storage-h">
        <h2 id="storage-h" className="text-lg font-semibold text-fg">Storage</h2>
        <p className="text-sm text-fg-muted">
          You are using {formatBytes(used ?? 0)} of your {formatBytes(l.perUserStorageBytes)} allowance. Deleting drafts and old files frees space.
        </p>
        <div className="h-2 overflow-hidden rounded bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(((used ?? 0) / l.perUserStorageBytes) * 100))}>
          <div className="h-full bg-accent" style={{ width: `${Math.min(100, ((used ?? 0) / l.perUserStorageBytes) * 100)}%` }} />
        </div>
      </section>
    </div>
  );
}
