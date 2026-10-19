import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { SignupForm } from "@/components/auth-forms";
import { getViewer } from "@/lib/auth";
import { publicEnv } from "@/lib/env";
import { getNonce } from "@/lib/nonce";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage() {
  if (await getViewer()) redirect("/dashboard");
  return (
    <AuthShell
      title="Create your free account"
      subtitle="Free forever. No paid tiers, no ads. Your email is never shown to anyone."
      footer={<>Already registered? <Link href="/login" className="text-accent hover:underline">Sign in</Link></>}
    >
      <SignupForm siteKey={publicEnv.turnstileSiteKey()} nonce={await getNonce()} />
    </AuthShell>
  );
}
