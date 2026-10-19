// Allowlist of template file formats. Which formats each platform accepts is
// stored in public.platforms (upload_formats, zip_formats) so admins can add
// platforms without a code change; this file defines what each format is and
// how it is validated.
//
// Compiled code (.dll, .jar) is accepted for platforms whose plugins ship that
// way (ATAS, Sierra Chart ACSIL, Quantower, MotiveWave studies). It is never
// run by SPIES, is scanned like everything else, and a listing that contains
// it always waits for a moderator before it is published.

export type FormatKind =
  | "json-config"
  | "xml-config"
  | "opaque-config"
  | "zip-package"
  | "text-doc"
  | "pine-script"
  | "pe-library"
  | "java-archive";

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
  json: { ext: "json", label: "JSON configuration (.json)", kind: "json-config" },
  zip: { ext: "zip", label: "ZIP package (.zip)", kind: "zip-package" },
  txt: { ext: "txt", label: "Plain text (.txt)", kind: "text-doc" },
  md: { ext: "md", label: "Markdown readme (.md)", kind: "text-doc" },
  pine: { ext: "pine", label: "TradingView Pine Script (.pine)", kind: "pine-script" },
  dll: { ext: "dll", label: "Compiled plugin (.dll)", kind: "pe-library" },
  jar: { ext: "jar", label: "Java plugin (.jar)", kind: "java-archive" },
};

/** Formats that contain code which runs inside the trading platform. */
export const CODE_FORMATS: ReadonlySet<string> = new Set(["dll", "jar"]);

/** Formats allowed inside a ZIP package (never another archive). */
export const ZIP_INNER_FORMATS: ReadonlySet<string> = new Set(
  Object.values(FORMATS).filter((f) => f.kind !== "zip-package" && f.kind !== "java-archive").map((f) => f.ext),
);

export interface PlatformFormats {
  /** Extensions accepted as a top-level upload. */
  upload: string[];
  /** Extensions accepted inside a ZIP package. */
  zipInner: string[];
}

/** Extensions refused with a specific explanation. */
export const BLOCKED_REASONS: Record<string, string> = {
  class: "Upload Java plugins as a .jar file.",
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

export type ExtensionCheck = { ok: true; format: FileFormat } | { ok: false; reason: string };

export function checkUploadExtension(rules: PlatformFormats | null | undefined, filename: string): ExtensionCheck {
  const ext = extensionOf(filename);
  if (!ext) return { ok: false, reason: "The file has no extension." };
  if (BLOCKED_REASONS[ext]) return { ok: false, reason: BLOCKED_REASONS[ext] };
  if (!rules) return { ok: false, reason: "Unknown platform." };
  if (!rules.upload.includes(ext) || !FORMATS[ext]) {
    return {
      ok: false,
      reason: `.${ext} files are not accepted for this platform. Allowed: ${rules.upload.map((e) => "." + e).join(", ")}.`,
    };
  }
  return { ok: true, format: FORMATS[ext] };
}

export const SCREENSHOT_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];
