// Content sniffing by magic bytes. Browser-supplied MIME types are never used.

export type Sniffed =
  | "pe-executable"
  | "elf-executable"
  | "macho-executable"
  | "java-class-or-macho-fat"
  | "shebang-script"
  | "ole-compound"
  | "zip"
  | "rar"
  | "7z"
  | "gzip"
  | "pdf"
  | "png"
  | "jpeg"
  | "webp"
  | "gif"
  | "unknown";

function startsWith(data: Uint8Array, sig: number[], offset = 0): boolean {
  if (data.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (data[offset + i] !== sig[i]) return false;
  return true;
}

export function sniff(data: Uint8Array): Sniffed {
  if (startsWith(data, [0x4d, 0x5a])) return "pe-executable"; // MZ
  if (startsWith(data, [0x7f, 0x45, 0x4c, 0x46])) return "elf-executable";
  if (
    startsWith(data, [0xfe, 0xed, 0xfa, 0xce]) || startsWith(data, [0xfe, 0xed, 0xfa, 0xcf]) ||
    startsWith(data, [0xce, 0xfa, 0xed, 0xfe]) || startsWith(data, [0xcf, 0xfa, 0xed, 0xfe])
  ) return "macho-executable";
  if (startsWith(data, [0xca, 0xfe, 0xba, 0xbe])) return "java-class-or-macho-fat";
  if (startsWith(data, [0x23, 0x21])) return "shebang-script"; // #!
  if (startsWith(data, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole-compound";
  if (startsWith(data, [0x50, 0x4b, 0x03, 0x04]) || startsWith(data, [0x50, 0x4b, 0x05, 0x06]) || startsWith(data, [0x50, 0x4b, 0x07, 0x08])) return "zip";
  if (startsWith(data, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return "rar";
  if (startsWith(data, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return "7z";
  if (startsWith(data, [0x1f, 0x8b])) return "gzip";
  if (startsWith(data, [0x25, 0x50, 0x44, 0x46])) return "pdf";
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(data, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(data, [0x52, 0x49, 0x46, 0x46]) && startsWith(data, [0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  if (startsWith(data, [0x47, 0x49, 0x46, 0x38])) return "gif";
  return "unknown";
}

/** Content types that are never acceptable inside a template, whatever the extension. */
export const FORBIDDEN_CONTENT: ReadonlySet<Sniffed> = new Set<Sniffed>([
  "pe-executable",
  "elf-executable",
  "macho-executable",
  "java-class-or-macho-fat",
  "shebang-script",
  "ole-compound",
  "rar",
  "7z",
  "gzip",
  "pdf",
]);

export function describeSniffed(s: Sniffed): string {
  switch (s) {
    case "pe-executable": return "a Windows executable or DLL";
    case "elf-executable": return "a Linux executable";
    case "macho-executable": return "a macOS executable";
    case "java-class-or-macho-fat": return "compiled Java or macOS code";
    case "shebang-script": return "a script";
    case "ole-compound": return "an Office/OLE compound document (may contain macros)";
    case "zip": return "a ZIP archive";
    case "rar": return "a RAR archive";
    case "7z": return "a 7-Zip archive";
    case "gzip": return "a gzip archive";
    case "pdf": return "a PDF document";
    case "png": return "a PNG image";
    case "jpeg": return "a JPEG image";
    case "webp": return "a WebP image";
    case "gif": return "a GIF image";
    default: return "unknown content";
  }
}

export type PeInfo = { ok: true; machine: number; is64: boolean; isDotNet: boolean } | { ok: false; reason: string };

/** Checks that a PE file is a well-formed DLL (not an .exe) and reports its architecture. */
export function inspectPeLibrary(data: Uint8Array): PeInfo {
  if (data.length < 0x40 || data[0] !== 0x4d || data[1] !== 0x5a) return { ok: false, reason: "The file is not a Windows DLL." };
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const peOffset = view.getUint32(0x3c, true);
  if (peOffset < 0x40 || peOffset + 24 > data.length) return { ok: false, reason: "The DLL header is malformed." };
  if (view.getUint32(peOffset, true) !== 0x00004550) return { ok: false, reason: "The DLL header is malformed." };
  const machine = view.getUint16(peOffset + 4, true);
  const optSize = view.getUint16(peOffset + 20, true);
  const characteristics = view.getUint16(peOffset + 22, true);
  if ((characteristics & 0x2000) === 0) return { ok: false, reason: "The file is a program (.exe), not a plugin DLL. Programs are never accepted." };
  const opt = peOffset + 24;
  if (optSize < 2 || opt + optSize > data.length) return { ok: false, reason: "The DLL header is malformed." };
  const magic = view.getUint16(opt, true);
  if (magic !== 0x10b && magic !== 0x20b) return { ok: false, reason: "The DLL header is malformed." };
  const is64 = magic === 0x20b;
  // Data directory 14 (CLR runtime header) is present for .NET assemblies.
  const dirBase = opt + (is64 ? 112 : 96);
  const clr = dirBase + 14 * 8;
  const isDotNet = clr + 8 <= opt + optSize && view.getUint32(clr, true) !== 0;
  return { ok: true, machine, is64, isDotNet };
}
