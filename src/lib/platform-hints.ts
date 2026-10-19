import { FORMATS, PLATFORM_FORMATS } from "@shared/formats.ts";

export function platformHints(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(PLATFORM_FORMATS).map(([id, f]) => [id, f.upload.map((ext) => FORMATS[ext]?.label ?? `.${ext}`).join(", ")]),
  );
}
