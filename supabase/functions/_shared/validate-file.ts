// Structural validation of an uploaded template file. Runs on the trusted
// side (Supabase Edge Function) against the bytes actually stored in the
// quarantine bucket. Validation is not a malware scan; it only rejects content
// that is malformed or outside the allowlist.

import { CODE_FORMATS, FORMATS, OTHER_FORMAT, acceptsExtension, checkUploadExtension, extensionOf, type PlatformFormats } from "./formats.ts";
import type { Limits } from "./limits.ts";
import { FORBIDDEN_CONTENT, describeSniffed, inspectPeLibrary, sniff } from "./magic.ts";
import { inspectZip, type ZipEntryInfo } from "./zip.ts";

export interface ValidationReport {
  format: string;
  detected: string;
  checks: string[];
  /** True when the file holds compiled code that runs inside the trading platform. */
  containsCode?: boolean;
  /** True when the file (or a file in the ZIP) is a type SPIES cannot check, so a moderator must look at it. */
  needsReview?: boolean;
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
    if (text === null) return "Text files must be UTF-8 text.";
    if (text.includes("\u0000")) return "The text file contains NUL characters.";
    return null;
  }
  if (kind === "pine-script") {
    const text = decodeText(data);
    if (text === null || text.includes("\u0000")) return "Pine Script files must be UTF-8 text.";
    if (!/\b(indicator|strategy|library|study)\s*\(/.test(text)) {
      return "This does not look like Pine Script (no indicator(), strategy() or library() call).";
    }
    return null;
  }
  return null;
}

export function validateTemplateFile(
  data: Uint8Array,
  filename: string,
  rules: PlatformFormats | null,
  limits: Limits,
): FileValidation {
  const checks: string[] = [];
  const ext = extensionOf(filename);
  const extCheck = checkUploadExtension(rules, filename);
  if (!extCheck.ok) return { ok: false, reason: extCheck.reason, report: { format: ext, checks } };
  checks.push(`extension .${ext} is allowed for this platform`);

  if (data.length === 0) return { ok: false, reason: "The file is empty.", report: { format: ext, checks } };
  if (data.length > limits.maxTemplateFileBytes) {
    return { ok: false, reason: "The file is larger than the allowed size.", report: { format: ext, checks } };
  }
  checks.push(`size ${data.length} bytes within limit`);

  const detected = sniff(data);
  const format = extCheck.format;
  const zipLimits = {
    maxEntries: limits.maxZipEntries,
    maxTotalUncompressedBytes: limits.maxZipTotalUncompressedBytes,
    maxCompressionRatio: limits.maxZipCompressionRatio,
    maxPathDepth: limits.maxZipPathDepth,
  };

  if (format.kind === "pe-library") {
    if (detected !== "pe-executable") return { ok: false, reason: "The file has a .dll extension but is not a Windows DLL.", report: { format: ext, detected, checks } };
    const pe = inspectPeLibrary(data);
    if (!pe.ok) return { ok: false, reason: pe.reason, report: { format: ext, detected, checks } };
    checks.push(`Windows DLL, ${pe.is64 ? "64" : "32"} bit${pe.isDotNet ? ", .NET assembly" : ", native code"}`);
    return { ok: true, report: { format: ext, detected: pe.isDotNet ? "dotnet-dll" : "native-dll", checks, containsCode: true } };
  }

  if (format.kind === "java-archive") {
    if (detected !== "zip") return { ok: false, reason: "The file has a .jar extension but is not a Java archive.", report: { format: ext, detected, checks } };
    const result = inspectZip(data, zipLimits, "any", undefined, { code: { class: "java-class-or-macho-fat" } });
    if (!result.ok) return { ok: false, reason: result.reason, report: { format: ext, detected, checks } };
    if (!result.entries.some((e) => e.name.toLowerCase().endsWith(".class"))) {
      return { ok: false, reason: "The .jar file contains no Java classes.", report: { format: ext, detected, checks } };
    }
    checks.push(`Java archive: ${result.entries.length} entries, ${result.totalUncompressed} bytes uncompressed, no nested archives or native code`);
    return {
      ok: true,
      report: { format: ext, detected: "java-archive", checks, containsCode: true, entries: result.entries.filter((e) => !e.isDirectory).map((e) => ({ name: e.name, uncompressedSize: e.uncompressedSize })) },
    };
  }

  if (FORBIDDEN_CONTENT.has(detected)) {
    return { ok: false, reason: `The file content is ${describeSniffed(detected)}, which is not accepted.`, report: { format: ext, detected, checks } };
  }

  if (format.kind === "zip-package") {
    if (detected !== "zip") {
      return { ok: false, reason: "The file has a .zip extension but is not a ZIP archive.", report: { format: ext, detected, checks } };
    }
    const inner = (rules?.zipInner ?? []).filter((e) => e !== "zip" && e !== "jar");
    const code = Object.fromEntries(inner.filter((e) => CODE_FORMATS.has(e)).map((e) => [e, "pe-executable" as const]));
    const anyOther = inner.includes(OTHER_FORMAT);
    let codeInside = false;
    let otherInside = false;
    const result = inspectZip(
      data,
      zipLimits,
      anyOther ? "any" : inner,
      (name, innerExt, content) => {
        if (anyOther) {
          if (!acceptsExtension(inner, innerExt)) return `"${name}" is not an allowed file type inside a package.`;
          if (!FORMATS[innerExt]) {
            otherInside = true;
            return null;
          }
        }
        if (innerExt === "dll") {
          codeInside = true;
          const pe = inspectPeLibrary(content);
          return pe.ok ? null : `${name}: ${pe.reason}`;
        }
        const problem = checkTextConfig(innerExt, content);
        return problem ? `${name}: ${problem}` : null;
      },
      { code },
    );
    if (!result.ok) return { ok: false, reason: result.reason, report: { format: ext, detected, checks } };
    checks.push(`zip structure valid: ${result.entries.length} entries, ${result.totalUncompressed} bytes uncompressed`);
    checks.push(codeInside ? "no encrypted, nested or path-traversal entries; contains plugin DLLs" : "no encrypted, nested, executable or path-traversal entries");
    return {
      ok: true,
      report: {
        format: ext,
        detected,
        checks,
        containsCode: codeInside,
        needsReview: otherInside,
        entries: result.entries.filter((e) => !e.isDirectory).map((e) => ({ name: e.name, uncompressedSize: e.uncompressedSize })),
      },
    };
  }

  if (format.kind === "other-file") {
    if (detected === "zip") {
      return { ok: false, reason: `The file has a .${ext} extension but is actually a ZIP archive. Upload it as a .zip package.`, report: { format: ext, detected, checks } };
    }
    checks.push("no program, script or archive signature found; a moderator checks this file type");
    return { ok: true, report: { format: ext, detected: detected === "unknown" ? "other" : detected, checks, needsReview: true } };
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
  if (format.kind === "pine-script") checks.push("Pine Script text");
  if (format.kind === "opaque-config") checks.push("proprietary configuration format: no executable or archive signature found");
  return { ok: true, report: { format: ext, detected: detected === "unknown" ? format.kind : detected, checks } };
}
