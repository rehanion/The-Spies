import "server-only";
import { serverEnv } from "@/lib/server-env";

export type ProcessorRequest =
  | { kind: "file"; id: string }
  | { kind: "screenshot"; id: string }
  | { kind: "avatar"; userId: string; key: string };

export interface ProcessorResponse {
  status?: "passed" | "failed" | "ready" | "pending" | "awaiting_upload";
  reason?: string;
  error?: string;
  sha256?: string;
  avatar_key?: string;
}

/** Calls the process-upload Edge Function with the shared server secret. */
export async function runProcessor(body: ProcessorRequest): Promise<{ httpStatus: number; data: ProcessorResponse }> {
  try {
    const res = await fetch(`${serverEnv.functionsUrl()}/process-upload`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-processor-secret": serverEnv.processorSecret() },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as ProcessorResponse;
    return { httpStatus: res.status, data };
  } catch {
    return { httpStatus: 503, data: { error: "processor_unreachable" } };
  }
}
