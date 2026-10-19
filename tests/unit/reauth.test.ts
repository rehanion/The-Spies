import { describe, expect, it } from "vitest";
import { lastAuthenticatedAt, signedInRecently } from "@/lib/reauth";

describe("recent sign-in check", () => {
  const now = 1_800_000_000;

  it("uses the latest amr timestamp", () => {
    const claims = { amr: [{ method: "password", timestamp: now - 3000 }, { method: "otp", timestamp: now - 60 }] };
    expect(lastAuthenticatedAt(claims)).toBe(now - 60);
    expect(signedInRecently(claims, now)).toBe(true);
  });

  it("rejects sessions older than 10 minutes", () => {
    expect(signedInRecently({ amr: [{ method: "password", timestamp: now - 601 }] }, now)).toBe(false);
    expect(signedInRecently({ amr: [{ method: "password", timestamp: now - 600 }] }, now)).toBe(true);
  });

  it("fails closed on missing or malformed claims", () => {
    expect(signedInRecently(null, now)).toBe(false);
    expect(signedInRecently({}, now)).toBe(false);
    expect(signedInRecently({ amr: "password" }, now)).toBe(false);
    expect(signedInRecently({ amr: [{ method: "password", timestamp: "soon" }] }, now)).toBe(false);
    expect(signedInRecently({ amr: [{ method: "password", timestamp: now + 3600 }] }, now)).toBe(false);
  });
});
