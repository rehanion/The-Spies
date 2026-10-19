import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { ForgotPasswordForm } from "@/components/auth-forms";
import { publicEnv } from "@/lib/env";
import { getNonce } from "@/lib/nonce";

export const metadata: Metadata = { title: "Reset password" };

export default async function ForgotPasswordPage() {
  return (
    <AuthShell title="Reset your password" subtitle="We will email you a link to choose a new password.">
      <ForgotPasswordForm siteKey={publicEnv.turnstileSiteKey()} nonce={await getNonce()} />
    </AuthShell>
  );
}
