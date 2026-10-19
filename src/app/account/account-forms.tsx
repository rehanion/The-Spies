"use client";

import { useRouter } from "next/navigation";
import { useActionState, useRef, useState, useTransition } from "react";
import { changeEmail, removeAvatar, updateProfile, type AccountState } from "./actions";
import { putWithProgress } from "@/components/upload/direct-upload";

function Message({ state }: { state: AccountState }) {
  if (!state) return null;
  return <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-ok" : "text-danger"}`}>{state.message}</p>;
}

export function ProfileForm({ username, displayName, bio }: { username: string; displayName: string; bio: string }) {
  const [state, action, pending] = useActionState(updateProfile, null);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="username" className="label">Username</label>
        <input id="username" name="username" defaultValue={username} required pattern="[a-z0-9_]{3,24}" maxLength={24} className="input" aria-describedby="username-hint" />
        <p id="username-hint" className="hint">Changing it changes your profile address. Old links will stop working.</p>
      </div>
      <div>
        <label htmlFor="display_name" className="label">Display name</label>
        <input id="display_name" name="display_name" defaultValue={displayName} maxLength={60} className="input" />
      </div>
      <div>
        <label htmlFor="bio" className="label">Bio</label>
        <textarea id="bio" name="bio" defaultValue={bio} maxLength={1000} rows={4} className="input h-auto py-2" />
        <p className="hint">Plain text. Links are not rendered.</p>
      </div>
      <Message state={state} />
      <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save profile"}</button>
    </form>
  );
}

export function AvatarForm({ hasAvatar, maxBytes }: { hasAvatar: boolean; maxBytes: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [state, setState] = useState<AccountState>(null);
  const [pending, start] = useTransition();

  async function upload(file: File) {
    setState(null);
    if (file.size > maxBytes) {
      setState({ ok: false, message: `Avatars can be at most ${Math.round(maxBytes / 1048576)} MB.` });
      return;
    }
    try {
      setBusy("Uploading…");
      const res = await fetch("/api/account/avatar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, size: file.size }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? "The upload could not be started.");
      await putWithProgress(data.uploadUrl, file, () => undefined);
      setBusy("Processing…");
      const done = await fetch("/api/account/avatar/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: data.key }),
      });
      const doneData = await done.json().catch(() => ({}));
      if (!done.ok) throw new Error(doneData.message ?? "The image was rejected.");
      setState({ ok: true, message: "Avatar updated." });
      router.refresh();
    } catch (e) {
      setState({ ok: false, message: e instanceof Error ? e.message : "Upload failed." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <input
        ref={input}
        type="file"
        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
        className="sr-only"
        aria-label="Choose an avatar image"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void upload(f);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary" disabled={!!busy || pending} onClick={() => input.current?.click()}>
          {busy ?? "Upload new avatar"}
        </button>
        {hasAvatar ? (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!!busy || pending}
            onClick={() =>
              start(async () => {
                setState(await removeAvatar());
                router.refresh();
              })
            }
          >
            Remove
          </button>
        ) : null}
      </div>
      <p className="hint">PNG, JPEG or WebP, at least 200×120 pixels. It is converted on the server and metadata is stripped.</p>
      <Message state={state} />
    </div>
  );
}

export function EmailForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(changeEmail, null);
  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="email" className="label">Email</label>
        <input id="email" name="email" type="email" defaultValue={email} required className="input" autoComplete="email" />
      </div>
      <Message state={state} />
      <button type="submit" className="btn btn-secondary" disabled={pending}>{pending ? "Sending…" : "Change email"}</button>
    </form>
  );
}
