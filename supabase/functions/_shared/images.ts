// Screenshot processing: verify the container by magic bytes, read declared
// dimensions from the header before decoding (pixel-flood protection), decode,
// downscale and re-encode to JPEG. Re-encoding drops all metadata (EXIF/GPS),
// embedded payloads and anything that is not pixels. Uploaded SVG/GIF/HTML are
// never accepted.

import { Image } from "imagescript";
import { sniff } from "./magic.ts";

export interface ProcessedImage {
  full: Uint8Array;
  thumb: Uint8Array;
  width: number;
  height: number;
  contentType: "image/jpeg";
  extension: "jpg";
}

export type ImageResult = { ok: true; image: ProcessedImage } | { ok: false; reason: string };

export interface ImageLimits {
  maxBytes: number;
  maxPixels: number;
  fullMaxWidth: number;
  thumbWidth: number;
}

/** Reads width/height from PNG, JPEG or WebP headers without decoding pixels. */
export function readImageDimensions(data: Uint8Array): { width: number; height: number } | null {
  const kind = sniff(data);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  try {
    if (kind === "png") {
      if (data.length < 24) return null;
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (kind === "jpeg") {
      let p = 2;
      while (p + 9 < data.length) {
        if (data[p] !== 0xff) return null;
        const marker = data[p + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue; }
        const len = view.getUint16(p + 2);
        if (len < 2) return null;
        // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: view.getUint16(p + 5), width: view.getUint16(p + 7) };
        }
        p += 2 + len;
      }
      return null;
    }
    if (kind === "webp") {
      const chunk = String.fromCharCode(data[12], data[13], data[14], data[15]);
      if (chunk === "VP8 " && data.length >= 30) {
        return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
      }
      if (chunk === "VP8L" && data.length >= 25) {
        const b = view.getUint32(21, true);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      if (chunk === "VP8X" && data.length >= 30) {
        const w = 1 + (data[24] | (data[25] << 8) | (data[26] << 16));
        const h = 1 + (data[27] | (data[28] << 8) | (data[29] << 16));
        return { width: w, height: h };
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

export async function processScreenshot(data: Uint8Array, limits: ImageLimits): Promise<ImageResult> {
  if (data.length === 0) return { ok: false, reason: "The image is empty." };
  if (data.length > limits.maxBytes) return { ok: false, reason: "The image is larger than the allowed size." };
  const kind = sniff(data);
  if (kind !== "png" && kind !== "jpeg" && kind !== "webp") {
    return { ok: false, reason: "Screenshots must be PNG, JPEG or WebP images." };
  }
  const dims = readImageDimensions(data);
  if (!dims || dims.width < 1 || dims.height < 1) return { ok: false, reason: "The image header is malformed." };
  if (dims.width * dims.height > limits.maxPixels) {
    return { ok: false, reason: `The image is too large (${dims.width}×${dims.height}). Maximum is ${limits.maxPixels.toLocaleString("en-US")} pixels.` };
  }
  if (dims.width < 200 || dims.height < 120) {
    return { ok: false, reason: "The image is too small to be a useful screenshot (minimum 200×120)." };
  }

  let image: Image;
  try {
    image = await Image.decode(data, { maxPixels: limits.maxPixels });
  } catch {
    return { ok: false, reason: "The image could not be decoded. It may be corrupt." };
  }
  if (image.width !== dims.width || image.height !== dims.height) {
    // Orientation tags may swap axes; anything else means the header lied.
    if (!(image.width === dims.height && image.height === dims.width)) {
      return { ok: false, reason: "The image header does not match its content." };
    }
  }

  const full = image.width > limits.fullMaxWidth ? image.clone().resize(limits.fullMaxWidth, Image.RESIZE_AUTO) : image.clone();
  const thumbSource = image.width > limits.thumbWidth ? image.resize(limits.thumbWidth, Image.RESIZE_AUTO) : image;
  const [fullBytes, thumbBytes] = await Promise.all([
    full.encodeJPEG({ quality: 90 }),
    thumbSource.encodeJPEG({ quality: 82 }),
  ]);
  return {
    ok: true,
    image: { full: fullBytes, thumb: thumbBytes, width: full.width, height: full.height, contentType: "image/jpeg", extension: "jpg" },
  };
}
