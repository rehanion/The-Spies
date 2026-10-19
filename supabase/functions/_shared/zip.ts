// Defensive ZIP inspection. Parses the central directory itself (never trusts
// a library to extract), verifies every entry against limits, decompresses
// each entry with a hard output cap and checks its CRC. Nothing is written to
// disk and nothing is executed.

import { Inflate } from "fflate";
import { crc32 } from "./hash.ts";
import { FORBIDDEN_CONTENT, describeSniffed, sniff, type Sniffed } from "./magic.ts";
import { extensionOf } from "./formats.ts";

export interface ZipLimits {
  maxEntries: number;
  maxTotalUncompressedBytes: number;
  maxCompressionRatio: number;
  maxPathDepth: number;
}

export interface ZipEntryInfo {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  method: "store" | "deflate";
  isDirectory: boolean;
}

export type ZipResult =
  | { ok: true; entries: ZipEntryInfo[]; totalUncompressed: number }
  | { ok: false; reason: string };

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;

class ZipError extends Error {}

function fail(reason: string): never {
  throw new ZipError(reason);
}

function findEocd(view: DataView): number {
  const min = Math.max(0, view.byteLength - (22 + 0xffff));
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  }
  return -1;
}

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      fail("An entry name is not valid UTF-8.");
    }
  }
  // CP437/latin1 names: only accept printable ASCII to avoid ambiguity.
  for (const b of bytes) if (b < 0x20 || b > 0x7e) fail("An entry name uses unsupported characters.");
  return String.fromCharCode(...bytes);
}

export function checkEntryPath(name: string, maxDepth: number): string | null {
  if (name.length === 0 || name.length > 255) return "An entry has an empty or overly long name.";
  if (/[\u0000-\u001f\u007f]/.test(name)) return "An entry name contains control characters.";
  if (name.includes("\\")) return "An entry name uses backslashes.";
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return "An entry uses an absolute path.";
  const parts = name.replace(/\/$/, "").split("/");
  if (parts.some((p) => p === ".." || p === "." || p === "")) return "An entry path tries to escape the archive (path traversal).";
  if (parts.length > maxDepth) return "The archive is nested too deeply.";
  return null;
}

function inflateCapped(data: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let written = 0;
  const inflater = new Inflate((chunk: Uint8Array) => {
    if (written + chunk.length > expected) fail("An entry decompresses to more data than declared (possible ZIP bomb).");
    out.set(chunk, written);
    written += chunk.length;
  });
  const CHUNK = 64 * 1024;
  try {
    for (let i = 0; i < data.length; i += CHUNK) {
      inflater.push(data.subarray(i, Math.min(i + CHUNK, data.length)), i + CHUNK >= data.length);
    }
    if (data.length === 0) inflater.push(new Uint8Array(0), true);
  } catch (err) {
    if (err instanceof ZipError) throw err;
    fail("An entry is corrupt and cannot be decompressed.");
  }
  if (written !== expected) fail("An entry's size does not match its header (malformed archive).");
  return out;
}

export interface ZipCodeRules {
  /** Inner extensions allowed to hold compiled code, with the content type each must be. */
  code?: Record<string, Sniffed>;
}

export function inspectZip(
  data: Uint8Array,
  limits: ZipLimits,
  allowedInnerExtensions: string[] | "any",
  checkInner?: (name: string, ext: string, content: Uint8Array) => string | null,
  rules: ZipCodeRules = {},
): ZipResult {
  try {
    if (data.length < 22) fail("The archive is too small to be a valid ZIP file.");
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const eocd = findEocd(view);
    if (eocd < 0) fail("The ZIP end-of-directory record is missing (malformed archive).");
    if (eocd >= 20 && view.getUint32(eocd - 20, true) === SIG_ZIP64_LOCATOR) fail("ZIP64 archives are not accepted.");
    const disk = view.getUint16(eocd + 4, true);
    const cdDisk = view.getUint16(eocd + 6, true);
    const entriesOnDisk = view.getUint16(eocd + 8, true);
    const totalEntries = view.getUint16(eocd + 10, true);
    const cdSize = view.getUint32(eocd + 12, true);
    const cdOffset = view.getUint32(eocd + 16, true);
    if (disk !== 0 || cdDisk !== 0 || entriesOnDisk !== totalEntries) fail("Multi-part archives are not accepted.");
    if (totalEntries === 0xffff || cdOffset === 0xffffffff) fail("ZIP64 archives are not accepted.");
    if (totalEntries === 0) fail("The archive is empty.");
    if (totalEntries > limits.maxEntries) fail(`The archive has ${totalEntries} entries; the limit is ${limits.maxEntries}.`);
    if (cdOffset + cdSize > eocd) fail("The ZIP central directory is out of bounds (malformed archive).");

    const entries: ZipEntryInfo[] = [];
    const seen = new Set<string>();
    let total = 0;
    let p = cdOffset;
    for (let i = 0; i < totalEntries; i++) {
      if (p + 46 > eocd || view.getUint32(p, true) !== SIG_CEN) fail("The ZIP central directory is corrupt.");
      const versionMadeBy = view.getUint16(p + 4, true);
      const flags = view.getUint16(p + 8, true);
      const method = view.getUint16(p + 10, true);
      const crc = view.getUint32(p + 16, true);
      const compSize = view.getUint32(p + 20, true);
      const uncompSize = view.getUint32(p + 24, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const externalAttrs = view.getUint32(p + 38, true);
      const localOffset = view.getUint32(p + 42, true);
      if (p + 46 + nameLen + extraLen + commentLen > eocd) fail("The ZIP central directory is corrupt.");
      const name = decodeName(data.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0);
      p += 46 + nameLen + extraLen + commentLen;

      if (flags & 0x1 || flags & 0x40) fail("Encrypted archives cannot be inspected and are not accepted.");
      if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff) fail("ZIP64 archives are not accepted.");
      const pathProblem = checkEntryPath(name, limits.maxPathDepth);
      if (pathProblem) fail(pathProblem);
      const hostOs = versionMadeBy >> 8;
      const unixMode = externalAttrs >>> 16;
      if (hostOs === 3 && (unixMode & 0xf000) === 0xa000) fail("Symbolic links inside archives are not accepted.");
      const key = name.toLowerCase();
      if (seen.has(key)) fail("The archive contains duplicate or colliding file names.");
      seen.add(key);

      const isDirectory = name.endsWith("/");
      if (isDirectory) {
        if (uncompSize !== 0) fail("A directory entry contains data (malformed archive).");
        entries.push({ name, compressedSize: compSize, uncompressedSize: 0, method: "store", isDirectory });
        continue;
      }
      if (method !== 0 && method !== 8) fail("The archive uses an unsupported compression method.");
      const ext = extensionOf(name);
      if (["zip", "jar", "7z", "rar", "gz", "tar", "cab", "iso"].includes(ext)) fail(`Nested archives are not accepted (${name}).`);
      if (allowedInnerExtensions !== "any" && !allowedInnerExtensions.includes(ext)) {
        fail(`"${name}" is not an allowed file type inside a package. Allowed: ${allowedInnerExtensions.map((e) => "." + e).join(", ")}.`);
      }
      if (uncompSize > 0 && compSize === 0) fail("An entry has an impossible compression ratio (possible ZIP bomb).");
      if (compSize > 0 && uncompSize / compSize > limits.maxCompressionRatio) fail("An entry is compressed suspiciously well (possible ZIP bomb).");
      total += uncompSize;
      if (total > limits.maxTotalUncompressedBytes) fail("The archive expands beyond the allowed total size.");

      // Local header must agree with the central directory.
      if (localOffset + 30 > cdOffset || view.getUint32(localOffset, true) !== SIG_LOC) fail("A local file header is missing (malformed archive).");
      const locFlags = view.getUint16(localOffset + 6, true);
      if (locFlags & 0x1) fail("Encrypted archives cannot be inspected and are not accepted.");
      const locMethod = view.getUint16(localOffset + 8, true);
      if (locMethod !== method) fail("Local and central headers disagree (malformed archive).");
      const locNameLen = view.getUint16(localOffset + 26, true);
      const locExtraLen = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + locNameLen + locExtraLen;
      const end = start + compSize;
      if (end > cdOffset) fail("An entry's data runs past the end of the archive (malformed archive).");
      const raw = data.subarray(start, end);
      const content = method === 0 ? (compSize === uncompSize ? raw : fail("A stored entry has inconsistent sizes.")) : inflateCapped(raw, uncompSize);
      if (crc32(content) !== crc) fail(`"${name}" failed its CRC check (corrupt archive).`);
      const kind = sniff(content);
      const expectedCode = rules.code?.[ext];
      if (expectedCode) {
        if (kind !== expectedCode) fail(`"${name}" is not a valid .${ext} file.`);
      } else if (kind === "zip" || FORBIDDEN_CONTENT.has(kind)) {
        fail(`"${name}" contains ${describeSniffed(kind)}, which is not accepted.`);
      }
      if (checkInner) {
        const problem = checkInner(name, ext, content);
        if (problem) fail(problem);
      }
      entries.push({ name, compressedSize: compSize, uncompressedSize: uncompSize, method: method === 0 ? "store" : "deflate", isDirectory });
    }
    if (!entries.some((e) => !e.isDirectory)) fail("The archive contains no files.");
    return { ok: true, entries, totalUncompressed: total };
  } catch (err) {
    if (err instanceof ZipError) return { ok: false, reason: err.message };
    return { ok: false, reason: "The archive could not be read (malformed archive)." };
  }
}
