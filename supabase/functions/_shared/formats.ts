// Allowlist of template file formats. Which formats each platform accepts is
// stored in public.platforms (upload_formats, zip_formats) so admins can add
// platforms without a code change; this file defines what each format is and
// how it is validated.
//
// Compiled code (.dll, .jar) is accepted for platforms whose plugins ship that
// way (ATAS, Sierra Chart ACSIL, Quantower, MotiveWave studies). It is never
// run by SPIES, is scanned like everything else, and a listing that contains
// it always waits for a moderator before it is published.
//
// A platform can also accept "other" files: any extension that is not a
// program, script, installer or archive. Their content is still checked for
// executable signatures and scanned, and a listing with one always waits for a
// moderator too, because SPIES cannot check what is inside them.

export type FormatKind =
  | "json-config"
  | "xml-config"
  | "opaque-config"
  | "zip-package"
  | "text-doc"
  | "pine-script"
  | "pe-library"
  | "java-archive"
  | "other-file";

export interface FileFormat {
  ext: string;
  label: string;
  kind: FormatKind;
}

export const FORMATS: Record<string, FileFormat> = {
  mwml: { ext: "mwml", label: "MotiveWave analysis (.mwml)", kind: "json-config" },
  tml: { ext: "tml", label: "MotiveWave template (.tml)", kind: "opaque-config" },
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
  other: { ext: "other", label: "Any other file type (not programs or scripts)", kind: "other-file" },
};

/** The pseudo format that lets a platform accept files SPIES has no check for. */
export const OTHER_FORMAT = "other";

/** True when a platform format list accepts this extension. */
export function acceptsExtension(formats: readonly string[], ext: string): boolean {
  if (!ext || BLOCKED_REASONS[ext]) return false;
  if (FORMATS[ext] && ext !== OTHER_FORMAT) return formats.includes(ext);
  return formats.includes(OTHER_FORMAT);
}

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
  xhtml: "Web pages are not accepted.",
  hta: "Executables are never accepted.",
  pif: "Executables are never accepted.",
  cpl: "Executables are never accepted.",
  msc: "Executables are never accepted.",
  sys: "Drivers are never accepted.",
  drv: "Drivers are never accepted.",
  ocx: "Native libraries are never accepted.",
  efi: "Executables are never accepted.",
  xll: "Excel add-ins are never accepted.",
  app: "Executables are never accepted.",
  run: "Executables are never accepted.",
  elf: "Executables are never accepted.",
  apk: "Installers are never accepted.",
  appx: "Installers are never accepted.",
  msix: "Installers are never accepted.",
  appxbundle: "Installers are never accepted.",
  msp: "Installers are never accepted.",
  dmg: "Installers are never accepted.",
  pkg: "Installers are never accepted.",
  deb: "Installers are never accepted.",
  rpm: "Installers are never accepted.",
  iso: "Disk images are never accepted.",
  img: "Disk images are never accepted.",
  vhd: "Disk images are never accepted.",
  vhdx: "Disk images are never accepted.",
  cab: "Only inspectable ZIP packages are accepted.",
  bz2: "Only inspectable ZIP packages are accepted.",
  xz: "Only inspectable ZIP packages are accepted.",
  tgz: "Only inspectable ZIP packages are accepted.",
  zst: "Only inspectable ZIP packages are accepted.",
  lnk: "Shortcuts are never accepted.",
  url: "Shortcuts are never accepted.",
  scf: "Shortcuts are never accepted.",
  inf: "Setup files are never accepted.",
  reg: "Registry files are never accepted.",
  jnlp: "Java launchers are never accepted.",
  application: "Installers are never accepted.",
  gadget: "Executables are never accepted.",
  chm: "Help files can run code and are not accepted.",
  wsf: "Scripts are never accepted.",
  wsh: "Scripts are never accepted.",
  ws: "Scripts are never accepted.",
  vbe: "Scripts are never accepted.",
  jse: "Scripts are never accepted.",
  mjs: "Scripts are never accepted.",
  cjs: "Scripts are never accepted.",
  ts: "Scripts are never accepted.",
  psm1: "Scripts are never accepted.",
  psd1: "Scripts are never accepted.",
  ps1xml: "Scripts are never accepted.",
  bash: "Scripts are never accepted.",
  zsh: "Scripts are never accepted.",
  ksh: "Scripts are never accepted.",
  csh: "Scripts are never accepted.",
  command: "Scripts are never accepted.",
  pl: "Scripts are never accepted.",
  rb: "Scripts are never accepted.",
  php: "Scripts are never accepted.",
  lua: "Scripts are never accepted.",
  applescript: "Scripts are never accepted.",
  scpt: "Scripts are never accepted.",
  docm: "Office files with macros are not accepted.",
  xlsm: "Office files with macros are not accepted.",
  pptm: "Office files with macros are not accepted.",
  xlam: "Office files with macros are not accepted.",
  dotm: "Office files with macros are not accepted.",
  doc: "Old Office files can hold macros and are not accepted.",
  xls: "Old Office files can hold macros and are not accepted.",
  ppt: "Old Office files can hold macros and are not accepted.",
  pdf: "PDF files are not accepted. Put instructions in the description or a .txt file.",
  // Types Windows or Office can run code from without any magic bytes to detect.
  sct: "Scripts are never accepted.",
  wsc: "Scripts are never accepted.",
  vb: "Scripts are never accepted.",
  vbscript: "Scripts are never accepted.",
  jsx: "Scripts are never accepted.",
  msh: "Scripts are never accepted.",
  mht: "Web pages are not accepted.",
  mhtml: "Web pages are not accepted.",
  shtml: "Web pages are not accepted.",
  xht: "Web pages are not accepted.",
  svgz: "SVG files can contain scripts and are not accepted.",
  xbap: "Executables are never accepted.",
  "appref-ms": "Shortcuts are never accepted.",
  "settingcontent-ms": "Shortcuts are never accepted.",
  "library-ms": "Shortcuts are never accepted.",
  "searchconnector-ms": "Shortcuts are never accepted.",
  website: "Shortcuts are never accepted.",
  desktop: "Shortcuts are never accepted.",
  ins: "Setup files are never accepted.",
  isp: "Setup files are never accepted.",
  msu: "Installers are never accepted.",
  diagcab: "Installers are never accepted.",
  one: "OneNote files can hold programs and are not accepted.",
  onepkg: "OneNote files can hold programs and are not accepted.",
  mdb: "Access databases can hold macros and are not accepted.",
  accdb: "Access databases can hold macros and are not accepted.",
  mde: "Access databases can hold macros and are not accepted.",
  accde: "Access databases can hold macros and are not accepted.",
  rtf: "RTF files can carry exploits and are not accepted. Use a .txt file.",
  iqy: "Excel query files are not accepted.",
  slk: "Excel link files are not accepted.",
  xlsb: "Office files with macros are not accepted.",
  xltm: "Office files with macros are not accepted.",
  potm: "Office files with macros are not accepted.",
  ppsm: "Office files with macros are not accepted.",
  sldm: "Office files with macros are not accepted.",
  ppam: "Office files with macros are not accepted.",
  other: "Rename the file with its real extension.",
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
  if (!acceptsExtension(rules.upload, ext)) {
    const listed = rules.upload.filter((e) => e !== OTHER_FORMAT).map((e) => "." + e).join(", ");
    return { ok: false, reason: `.${ext} files are not accepted for this platform. Allowed: ${listed}.` };
  }
  return { ok: true, format: FORMATS[ext] ?? { ext, label: `.${ext} file`, kind: "other-file" } };
}

export const SCREENSHOT_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];
