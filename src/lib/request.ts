import "server-only";
import { headers } from "next/headers";
import { sha256Hex } from "@shared/hash.ts";
import { serverEnv } from "@/lib/server-env";

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("cf-connecting-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "unknown"
  );
}

/** Salted hash so raw IP addresses are never stored. */
export async function actorHash(userId: string | null): Promise<string> {
  const ip = await clientIp();
  return sha256Hex(new TextEncoder().encode(`${serverEnv.actorHashSalt()}|${userId ?? "anon"}|${userId ? "" : ip}`));
}

export async function ipHash(): Promise<string> {
  const ip = await clientIp();
  return (await sha256Hex(new TextEncoder().encode(`${serverEnv.actorHashSalt()}|ip|${ip}`))).slice(0, 32);
}
