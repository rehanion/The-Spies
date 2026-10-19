"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset, signIn, signUp, updatePassword, type AuthState } from "@/app/login/actions";
import { Turnstile } from "@/components/turnstile";

function Message({ state }: { state: AuthState }) {
  if (!state) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={`rounded-md border px-3 py-2 text-sm ${state.ok ? "border-ok/40 text-ok" : "border-danger/40 text-danger"}`}>
      {state.message}
    </p>
  );
}

export function LoginForm({ next, siteKey, nonce }: { next: string; siteKey: string; nonce?: string }) {
  const [state, action, pending] = useActionState(signIn, null);
  return (
    <form action={action} className="space-y-4" noValidate={false}>
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="email" className="label">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required className="input" />
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          <label htmlFor="password" className="label">Password</label>
          <Link href="/forgot-password" className="text-xs text-fg-muted hover:text-accent">Forgot password?</Link>
        </div>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
      </div>
      <Turnstile siteKey={siteKey} nonce={nonce} action="login" resetKey={state} />
      <Message state={state} />
      <button type="submit" disabled={pending} className="btn btn-primary w-full">{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

export function SignupForm({ siteKey, nonce }: { siteKey: string; nonce?: string }) {
  const [state, action, pending] = useActionState(signUp, null);
  if (state?.ok) return <Message state={state} />;
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="username" className="label">Username</label>
        <input id="username" name="username" autoComplete="username" required minLength={3} maxLength={24} pattern="[a-z0-9_]{3,24}" className="input" aria-describedby="username-hint" />
        <p id="username-hint" className="hint">3 to 24 lowercase letters, numbers or underscores. Shown publicly.</p>
      </div>
      <div>
        <label htmlFor="email" className="label">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required className="input" />
      </div>
      <div>
        <label htmlFor="password" className="label">Password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} className="input" aria-describedby="password-hint" />
        <p id="password-hint" className="hint">At least 10 characters with a letter and a number.</p>
      </div>
      <label className="flex items-start gap-2 text-sm text-fg-muted">
        <input type="checkbox" name="rules" required className="mt-1 accent-[var(--color-accent)]" />
        <span>I agree to the <Link href="/rules" className="underline" target="_blank">acceptable use rules</Link> and will only upload files I have the right to share.</span>
      </label>
      <Turnstile siteKey={siteKey} nonce={nonce} action="signup" resetKey={state} />
      <Message state={state} />
      <button type="submit" disabled={pending} className="btn btn-primary w-full">{pending ? "Creating account…" : "Create account"}</button>
    </form>
  );
}

export function ForgotPasswordForm({ siteKey, nonce }: { siteKey: string; nonce?: string }) {
  const [state, action, pending] = useActionState(requestPasswordReset, null);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="email" className="label">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required className="input" />
      </div>
      <Turnstile siteKey={siteKey} nonce={nonce} action="reset" resetKey={state} />
      <Message state={state} />
      <button type="submit" disabled={pending} className="btn btn-primary w-full">{pending ? "Sending…" : "Send reset link"}</button>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, null);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="password" className="label">New password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} className="input" />
      </div>
      <Message state={state} />
      <button type="submit" disabled={pending} className="btn btn-primary w-full">{pending ? "Saving…" : "Set new password"}</button>
    </form>
  );
}
