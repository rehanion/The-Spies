// Display-name sanitising for user-supplied filenames. Storage keys are always
// random UUIDs generated server-side; the original name is only metadata and
// the Content-Disposition filename on download.

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;
const RESERVED = /[<>:"/\\|?*]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

export function sanitizeFilename(input: string, maxLength = 120): string | null {
  if (typeof input !== "string") return null;
  // Drop any directory component a browser or attacker might send.
  let name = input.split(/[\\/]/).pop() ?? "";
  name = name.normalize("NFC").replace(CONTROL, "").replace(RESERVED, "_").trim();
  name = name.replace(/^\.+/, "").replace(/\s+/g, " ");
  if (!name || name === "." || name === "..") return null;
  if (WINDOWS_RESERVED.test(name)) name = "_" + name;
  if (name.length > maxLength) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 ? name.slice(dot) : "";
    if (ext.length > 17) return null;
    name = name.slice(0, maxLength - ext.length) + ext;
  }
  return name;
}

/** RFC 6266 / 5987 Content-Disposition value for a download. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
