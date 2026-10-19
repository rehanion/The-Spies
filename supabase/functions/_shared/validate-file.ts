// Structural validation of an uploaded template file. Runs on the trusted
// side (Supabase Edge Function) against the bytes actually stored in the
// quarantine bucket. Validation is not a malware scan; it only rejects content
// that is malformed or outside the allowlist.

import { FORMATS, PLATFORM_FORMATS, checkUploadExtension, extensionOf } from "./formats.ts";
import type { Limits } from "./limits.ts";
import { FORBIDDEN_CONTENT, describeSniffed, sniff } from "./magic.ts";
import { inspectZip, type ZipEntryInfo } from "./zip.ts";

export interface ValidationReport {
  format: string;
  detected: string;
  checks: string[];
  entries?: Pick<ZipEntryInfo, "name" | "uncompressedSize">[];
}

export type FileValidation =
  | { ok: true; report: ValidationReport }
  | { ok: false; reason: string; report: Partial<ValidationReport> };

function decodeText(data: Uint8Array): string | null {
  try {
    if (data.length >= 2 && ((data[0] === 0xff && data[1] === 0xfe) || (data[0] === 0xfe && data[1] === 0xff))) {
      return new TextDecoder(data[0] === 0xff ? "utf-16le" : "utf-16be", { fatal: true }).decode(data);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return null;
  }
}

export function checkTextConfig(ext: string, data: Uint8Array): string | null {
  const kind = FORMATS[ext]?.kind;
  if (kind === "json-config") {
    const text = decodeText(data);
    if (text === null) return `The .${ext} file is not valid UTF-8 text.`;
    try {
      const parsed = JSON.parse(text.replace(/^﻿/, ""));
      if (parsed === null || typeof parsed !== "object") return `The .${ext} file does not contain a JSON object.`;
    } catch {
      return `The .${ext} file is not valid JSON.`;
    }
    return null;
  }
  if (kind === "xml-config") {
    const text = decodeText(data);
    if (text === null) return "The XML file is not valid UTF-8 or UTF-16 text.";
    const body = text.replace(/^﻿/, "").trimStart();
    if (!body.startsWith("<")) return "The file does not look like an XML document.";
    if (/<!DOCTYPE|<!ENTITY/i.test(body)) return "XML files with DOCTYPE or ENTITY declarations are not accepted.";
    if (body.includes("\u0000")) return "The XML file contains NUL characters.";
    const open = (body.match(/</g) ?? []).length;
    const close = (body.match(/>/g) ?? []).length;
    if (open === 0 || close === 0) return "The XML file is malformed.";
    return null;
  }
  if (kind === "text-doc") {
    const text = decodeText(data);
    if (text === null) return "Readme files must be UTF-8 text.";
    return null;
  }
  return null;
}

export function validateTemplateFile(
  data: Uint8Array,
  filename: string,
  platformId: string,
  limits: Limits,
): FileValidation {
  const checks: string[] = [];
  const ext = extensionOf(filename);
  const extCheck = checkUploadExtension(platformId, filename);
  if (!extCheck.ok) return { ok: false, reason: extCheck.reason, report: { format: ext, checks } };
  checks.push(`extension .${ext} is allowlisted for ${platformId}`);

  if (data.length === 0) return { ok: false, reason: "The file is empty.", report: { format: ext, checks } };
  if (data.length > limits.maxTemplateFileBytes) {
    return { ok: false, reason: "The file is larger than the allowed size.", report: { format: ext, checks } };
  }
  checks.push(`size ${data.length} bytes within limit`);

  const detected = sniff(data);
  if (FORBIDDEN_CONTENT.has(detected)) {
    return { ok: false, reason: `The file content is ${describeSniffed(detected)}, which is not accepted.`, report: { format: ext, detected, checks } };
  }
  const format = extCheck.format;

  if (format.kind === "zip-package") {
    if (detected !== "zip") {
      return { ok: false, reason: "The file has a .zip extension but is not a ZIP archive.", report: { format: ext, detected, checks } };
    }
    const inner = PLATFORM_FORMATS[platformId]?.zipInner ?? [];
    const result = inspectZip(
      data,
      {
        maxEntries: limits.maxZipEntries,
        maxTotalUncompressedBytes: limits.maxZipTotalUncompressedBytes,
        maxCompressionRatio: limits.maxZipCompressionRatio,
        maxPathDepth: limits.maxZipPathDepth,
      },
      inner,
      (name, innerExt, content) => {
        const problem = checkTextConfig(innerExt, content);
        return problem ? `${name}: ${problem}` : null;
      },
    );
    if (!result.ok) return { ok: false, reason: result.reason, report: { format: ext, detected, checks } };
    checks.push(`zip structure valid: ${result.entries.length} entries, ${result.totalUncompressed} bytes uncompressed`);
    checks.push("no encrypted, nested, executable or path-traversal entries");
    return {
      ok: true,
      report: {
        format: ext,
        detected,
        checks,
        entries: result.entries.filter((e) => !e.isDirectory).map((e) => ({ name: e.name, uncompressedSize: e.uncompressedSize })),
      },
    };
  }

  if (detected === "zip") {
    return { ok: false, reason: `The file has a .${ext} extension but is actually a ZIP archive. Upload it as a .zip package.`, report: { format: ext, detected, checks } };
  }
  if (detected !== "unknown") {
    return { ok: false, reason: `The file content is ${describeSniffed(detected)}, which does not match .${ext}.`, report: { format: ext, detected, checks } };
  }
  const textProblem = checkTextConfig(ext, data);
  if (textProblem) return { ok: false, reason: textProblem, report: { format: ext, detected, checks } };
  if (format.kind === "json-config") checks.push("parsed as JSON");
  if (format.kind === "xml-config") checks.push("XML prolog/body check passed, no DOCTYPE/ENTITY");
  if (format.kind === "opaque-config") checks.push("proprietary configuration format: no executable or archive signature found");
  return { ok: true, report: { format: ext, detected: detected === "unknown" ? format.kind : detected, checks } };
}
