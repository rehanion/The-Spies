import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getViewer } from "@/lib/auth";
import { runProcessor } from "@/lib/processor";
import { consumeRateLimit } from "@/lib/rate-limit";

const bodySchema = z.object({ key: z.string().max(200) });

export async function POST(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer?.profile) return NextResponse.json({ message: "Sign in first." }, { status: 401 });
  if (viewer.profile.is_banned) return NextResponse.json({ message: "Your account is suspended." }, { status: 403 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  // The key must be one this user could have reserved; the processor checks it again.
  if (!parsed.success || !new RegExp(`^avatars/${viewer.userId}/[0-9a-f-]{36}\\.bin$`).test(parsed.data.key)) {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  }
  if (!(await consumeRateLimit("process", viewer.userId))) {
    return NextResponse.json({ message: "Too many requests. Try again later." }, { status: 429 });
  }
  const result = await runProcessor({ kind: "avatar", userId: viewer.userId, key: parsed.data.key });
  if (result.data.status === "ready") {
    revalidatePath("/", "layout");
    return NextResponse.json({ status: "ready" });
  }
  if (result.data.status === "awaiting_upload") return NextResponse.json({ message: "The upload did not reach storage." }, { status: 409 });
  if (result.data.status === "failed") return NextResponse.json({ message: result.data.reason ?? "The image was rejected." }, { status: 422 });
  return NextResponse.json({ message: "The image could not be processed. Please try again." }, { status: 502 });
}
