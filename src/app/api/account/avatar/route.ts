import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getViewer } from "@/lib/auth";
import { consumeRateLimit } from "@/lib/rate-limit";
import { limits, serverEnv } from "@/lib/server-env";
import { storage } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { UploadError, checkQuotas } from "@/lib/uploads";
import { SCREENSHOT_EXTENSIONS, extensionOf } from "@shared/formats.ts";

const bodySchema = z.object({ filename: z.string().min(1).max(255), size: z.number().int().positive() });

// Reserves an avatar upload into the private avatar-uploads bucket (2 MB per
// object). The reservation is recorded so the processor only accepts this
// key and quotas count it. The processor re-encodes the image to JPEG and
// publishes the result; the original is deleted.
export async function POST(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer?.profile) return NextResponse.json({ message: "Sign in first." }, { status: 401 });
  if (viewer.profile.is_banned) return NextResponse.json({ message: "Your account is suspended." }, { status: 403 });
  if (serverEnv.uploadsPaused()) return NextResponse.json({ message: "Uploads are paused right now." }, { status: 503 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  if (!SCREENSHOT_EXTENSIONS.includes(extensionOf(parsed.data.filename))) {
    return NextResponse.json({ message: "Avatars must be PNG, JPEG or WebP images." }, { status: 415 });
  }
  if (parsed.data.size > limits().maxAvatarBytes) {
    return NextResponse.json({ message: `Avatars can be at most ${Math.round(limits().maxAvatarBytes / 1048576)} MB.` }, { status: 413 });
  }
  if (!(await consumeRateLimit("uploadInit", viewer.userId))) {
    return NextResponse.json({ message: "Too many uploads. Try again later." }, { status: 429 });
  }
  const key = `avatars/${viewer.userId}/${crypto.randomUUID()}.bin`;
  try {
    await checkQuotas(viewer.userId, parsed.data.size);
    const { error } = await createAdminClient()
      .from("avatar_uploads")
      .insert({ user_id: viewer.userId, storage_key: key, declared_size_bytes: parsed.data.size });
    if (error) throw new Error("reservation failed");
    const signed = await storage.createUploadUrl("avatar-uploads", key);
    return NextResponse.json({ key, uploadUrl: signed.signedUrl });
  } catch (e) {
    if (e instanceof UploadError) return NextResponse.json({ message: e.message }, { status: e.status });
    return NextResponse.json({ message: "Storage is temporarily unavailable." }, { status: 503 });
  }
}
