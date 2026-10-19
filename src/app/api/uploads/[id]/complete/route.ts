import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getViewer } from "@/lib/auth";
import { runProcessor } from "@/lib/processor";
import { consumeRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({ kind: z.enum(["file", "screenshot"]) });

// Called by the browser after the direct upload finished. Verifies ownership,
// then asks the processor to hash, validate and (for screenshots) re-encode
// the stored object. The client's own claims about the file are not used.
export async function POST(request: NextRequest, ctx: RouteContext<"/api/uploads/[id]/complete">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const viewer = await getViewer();
  if (!viewer?.profile) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (viewer.profile.is_banned) return NextResponse.json({ error: "suspended", message: "Your account is suspended." }, { status: 403 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  if (!(await consumeRateLimit("process", viewer.userId))) {
    return NextResponse.json({ status: "error", message: "Too many requests. Wait a little and try again." }, { status: 429 });
  }

  const supabase = await createClient();
  const table = parsed.data.kind === "file" ? "template_files" : "template_screenshots";
  const { data: row } = await supabase.from(table).select("id, uploader_id").eq("id", id).maybeSingle();
  if (!row || row.uploader_id !== viewer.userId) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = await runProcessor({ kind: parsed.data.kind, id });
  if (result.data.status === "awaiting_upload") {
    return NextResponse.json({ status: "awaiting_upload", message: "The upload did not reach storage. Please try again." }, { status: 409 });
  }
  if (result.httpStatus >= 500 || result.data.error) {
    return NextResponse.json(
      { status: "error", message: "The file is stored but could not be processed yet. Use “Retry processing” in a moment." },
      { status: 502 },
    );
  }
  return NextResponse.json({ status: result.data.status, message: result.data.reason ?? null, sha256: result.data.sha256 ?? null });
}
