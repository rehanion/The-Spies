import { describe, expect, it } from "vitest";
import { Image } from "imagescript";
import { processScreenshot, readImageDimensions } from "@shared/images.ts";

const LIMITS = { maxBytes: 8 * 1024 * 1024, maxPixels: 4096 * 4096, fullMaxWidth: 1920, thumbWidth: 640 };

async function png(w: number, h: number) {
  const img = new Image(w, h);
  img.fill(0x336699ff);
  return new Uint8Array(await img.encode());
}

describe("processScreenshot", () => {
  it("re-encodes PNG to JPEG with a thumbnail", async () => {
    const r = await processScreenshot(await png(2400, 1200), LIMITS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.image.full[0]).toBe(0xff);
    expect(r.image.full[1]).toBe(0xd8);
    expect(r.image.width).toBe(1920);
    expect(readImageDimensions(r.image.thumb)?.width).toBe(640);
  });

  it("rejects SVG, HTML and polyglots", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await processScreenshot(svg, LIMITS)).ok).toBe(false);
    expect((await processScreenshot(new TextEncoder().encode("<html><body>hi"), LIMITS)).ok).toBe(false);
    const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    expect((await processScreenshot(fakePng, LIMITS)).ok).toBe(false);
  });

  it("rejects too small and too large images", async () => {
    expect((await processScreenshot(await png(100, 50), LIMITS)).ok).toBe(false);
    expect((await processScreenshot(await png(800, 600), { ...LIMITS, maxPixels: 1000 })).ok).toBe(false);
    expect((await processScreenshot(await png(800, 600), { ...LIMITS, maxBytes: 10 })).ok).toBe(false);
  });
});
