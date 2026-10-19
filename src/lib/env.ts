// Environment access. NEXT_PUBLIC_* values are inlined at build time and are
// safe for the browser. Everything else is read on the server only.

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const publicEnv = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabasePublishableKey: () =>
    required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  siteUrl: () => (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  turnstileSiteKey: () => process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
};

export function previewUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  return `${publicEnv.supabaseUrl()}/storage/v1/object/public/previews/${key}`;
}
