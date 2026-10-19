import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "@/components/auth-forms";
import { getViewer } from "@/lib/auth";
import { publicEnv } from "@/lib/env";
import { getNonce } from "@/lib/nonce";
import { safeNextPath } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : undefined, "/dashboard");
  if (await getViewer()) redirect(next);
  return (
    <AuthShell
      title="Sign in"
      subtitle="Browsing is open to everyone. An account lets you download, upload, review and save favorites."
      footer={<>New here? <Link href="/signup" className="text-accent hover:underline">Create a free account</Link></>}
    >
      {sp.confirmed ? <p className="mb-4 text-sm text-ok">Email confirmed. You can sign in now.</p> : null}
      {sp.error ? <p role="alert" className="mb-4 text-sm text-danger">That link is invalid or has expired.</p> : null}
      <LoginForm next={next} siteKey={publicEnv.turnstileSiteKey()} nonce={await getNonce()} />
    </AuthShell>
  );
}
