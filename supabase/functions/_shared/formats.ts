// Explicit allowlist of template file formats, per trading platform.
// Sources (checked 2026-10-19):
//  - MotiveWave: analyses export as .mwml (JSON); analysis packs and workspace
//    backups are ZIP files. Custom studies are .jar/.class (executable Java) and
//    are NOT accepted.
//  - Sierra Chart: chartbooks (.Cht), study collections (.StdyCollct) and trade
//    window configs (.twconfig). ACSIL custom studies are native .dll files and
//    are NOT accepted.
//  - Quantower: workspaces and templates are XML documents. Custom indicators
//    are .NET .dll files and are NOT accepted. Quantower backup ZIPs contain
//    connection credentials, so ZIPs may only contain allowlisted config files.
// Adding a platform: add a row to public.platforms (migration) and an entry to
// PLATFORM_FORMATS below. Nothing else needs to change.

export type FormatKind = "json-config" | "xml-config" | "opaque-config" | "zip-package" | "text-doc";

export interface FileFormat {
  ext: string;
  label: string;
  kind: FormatKind;
}

export const FORMATS: Record<string, FileFormat> = {
  mwml: { ext: "mwml", label: "MotiveWave analysis (.mwml)", kind: "json-config" },
  cht: { ext: "cht", label: "Sierra Chart chartbook (.Cht)", kind: "opaque-config" },
  stdycollct: { ext: "stdycollct", label: "Sierra Chart study collection (.StdyCollct)", kind: "opaque-config" },
  twconfig: { ext: "twconfig", label: "Sierra Chart trade window config (.twconfig)", kind: "opaque-config" },
  xml: { ext: "xml", label: "XML configuration (.xml)", kind: "xml-config" },
  zip: { ext: "zip", label: "ZIP package of configuration files (.zip)", kind: "zip-package" },
  txt: { ext: "txt", label: "Plain text readme (.txt)", kind: "text-doc" },
  md: { ext: "md", label: "Markdown readme (.md)", kind: "text-doc" },
};

export interface PlatformFormats {
  /** Extensions accepted as a top-level upload. */
  upload: string[];
  /** Extensions accepted inside a ZIP package. */
  zipInner: string[];
}

export const PLATFORM_FORMATS: Record<string, PlatformFormats> = {
  motivewave: { upload: ["mwml", "zip"], zipInner: ["mwml", "txt", "md"] },
  "sierra-chart": { upload: ["cht", "stdycollct", "twconfig", "zip"], zipInner: ["cht", "stdycollct", "twconfig", "txt", "md"] },
  quantower: { upload: ["xml", "zip"], zipInner: ["xml", "txt", "md"] },
};

/** Extensions refused with a specific explanation. */
export const BLOCKED_REASONS: Record<string, string> = {
  dll: "Compiled plugins (.dll) run native code and are not accepted. A separate manual-review process would be required.",
  jar: "Java archives (.jar) contain executable code and are not accepted.",
  class: "Java class files contain executable code and are not accepted.",
  exe: "Executables are never accepted.",
  msi: "Installers are never accepted.",
  bat: "Scripts are never accepted.",
  cmd: "Scripts are never accepted.",
  ps1: "Scripts are never accepted.",
  vbs: "Scripts are never accepted.",
  js: "Scripts are never accepted.",
  sh: "Scripts are never accepted.",
  py: "Scripts are never accepted.",
  scr: "Executables are never accepted.",
  com: "Executables are never accepted.",
  so: "Native libraries are never accepted.",
  dylib: "Native libraries are never accepted.",
  cs: "Source code (.cs) must be compiled before use; it needs a separate manual-review process and is not accepted yet.",
  cpp: "Source code (.cpp) must be compiled before use; it needs a separate manual-review process and is not accepted yet.",
  config: "Platform .config files can contain account credentials and are not accepted.",
  scid: "Market data files are not templates.",
  dly: "Market data files are not templates.",
  "7z": "Only inspectable ZIP packages are accepted.",
  rar: "Only inspectable ZIP packages are accepted.",
  gz: "Only inspectable ZIP packages are accepted.",
  tar: "Only inspectable ZIP packages are accepted.",
  svg: "SVG files can contain scripts and are not accepted.",
  html: "Web pages are not accepted.",
  htm: "Web pages are not accepted.",
};

export function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function allowedUploadExtensions(platformId: string): string[] {
  return PLATFORM_FORMATS[platformId]?.upload ?? [];
}

export type ExtensionCheck = { ok: true; format: FileFormat } | { ok: false; reason: string };

export function checkUploadExtension(platformId: string, filename: string): ExtensionCheck {
  const ext = extensionOf(filename);
  if (!ext) return { ok: false, reason: "The file has no extension." };
  if (BLOCKED_REASONS[ext]) return { ok: false, reason: BLOCKED_REASONS[ext] };
  const platform = PLATFORM_FORMATS[platformId];
  if (!platform) return { ok: false, reason: "Unknown platform." };
  if (!platform.upload.includes(ext) || !FORMATS[ext]) {
    return {
      ok: false,
      reason: `.${ext} files are not accepted for this platform. Allowed: ${platform.upload.map((e) => "." + e).join(", ")}.`,
    };
  }
  return { ok: true, format: FORMATS[ext] };
}

export const SCREENSHOT_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];
