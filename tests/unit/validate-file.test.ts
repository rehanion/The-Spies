import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { DEFAULT_LIMITS, readLimits } from "@shared/limits.ts";
import { validateTemplateFile, checkTextConfig } from "@shared/validate-file.ts";
import { checkUploadExtension, extensionOf } from "@shared/formats.ts";
import { sniff } from "@shared/magic.ts";
import { FALLBACK_CATALOG, makeCatalog } from "@/lib/catalog";

const L = DEFAULT_LIMITS;
const catalog = makeCatalog(FALLBACK_CATALOG);
const rules = (id: string) => catalog.rules(id);

describe("format allowlist", () => {
  it("accepts only each platform's formats", () => {
    expect(checkUploadExtension(rules("quantower"), "a.xml").ok).toBe(true);
    expect(checkUploadExtension(rules("quantower"), "a.mwml").ok).toBe(false);
    expect(checkUploadExtension(rules("sierra-chart"), "Layout.Cht").ok).toBe(true);
    expect(checkUploadExtension(rules("motivewave"), "x.mwml").ok).toBe(true);
    expect(checkUploadExtension(rules("unknown-platform"), "x.xml").ok).toBe(false);
  });

  it("explains blocked types", () => {
    for (const name of ["x.exe", "s.ps1", "i.jar", "Strategy.class", "Indicator.cs", "Quantower.config", "pic.svg", "page.html"]) {
      const r = checkUploadExtension(rules("quantower"), name);
      expect(r.ok, name).toBe(false);
      if (!r.ok) expect(r.reason.length).toBeGreaterThan(10);
    }
  });

  it("handles tricky names", () => {
    expect(extensionOf("archive.xml.exe")).toBe("exe");
    expect(extensionOf(".xml")).toBe("");
    expect(extensionOf("noext")).toBe("");
    expect(extensionOf("dir\\file.XML")).toBe("xml");
  });
});

describe("validateTemplateFile", () => {
  it("accepts valid XML, JSON and opaque configs", () => {
    expect(validateTemplateFile(strToU8("<Workspace/>"), "w.xml", rules("quantower"), L).ok).toBe(true);
    expect(validateTemplateFile(strToU8('{"analysis":[]}'), "a.mwml", rules("motivewave"), L).ok).toBe(true);
    expect(validateTemplateFile(new Uint8Array([1, 2, 3, 4, 5]), "c.cht", rules("sierra-chart"), L).ok).toBe(true);
  });

  it("detects spoofed content regardless of extension and MIME", () => {
    const pe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);
    const elf = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2]);
    expect(validateTemplateFile(pe, "c.cht", rules("sierra-chart"), L)).toMatchObject({ ok: false });
    expect(validateTemplateFile(elf, "w.xml", rules("quantower"), L)).toMatchObject({ ok: false });
    expect(validateTemplateFile(strToU8("#!/bin/sh\nrm -rf /"), "c.twconfig", rules("sierra-chart"), L)).toMatchObject({ ok: false });
    expect(validateTemplateFile(strToU8("not a zip"), "p.zip", rules("quantower"), L)).toMatchObject({ ok: false });
  });

  it("rejects XML entity attacks and broken JSON", () => {
    expect(checkTextConfig("xml", strToU8('<!DOCTYPE x [<!ENTITY a "b">]><x/>'))).toMatch(/DOCTYPE/);
    expect(checkTextConfig("xml", strToU8("hello"))).toMatch(/XML/);
    expect(checkTextConfig("mwml", strToU8("{nope"))).toMatch(/JSON/);
    expect(checkTextConfig("mwml", strToU8("42"))).toMatch(/object/);
    expect(checkTextConfig("xml", new Uint8Array([0xc3, 0x28]))).toMatch(/UTF/);
  });

  it("validates ZIP packages including inner content", () => {
    const good = zipSync({ "w.xml": strToU8("<Workspace/>"), "readme.txt": strToU8("hi") });
    expect(validateTemplateFile(good, "pack.zip", rules("quantower"), L).ok).toBe(true);
    const badInner = zipSync({ "w.xml": strToU8('<!DOCTYPE x><x/>') });
    expect(validateTemplateFile(badInner, "pack.zip", rules("quantower"), L)).toMatchObject({ ok: false });
    const wrongPlatform = zipSync({ "a.mwml": strToU8("{}") });
    expect(validateTemplateFile(wrongPlatform, "pack.zip", rules("quantower"), L)).toMatchObject({ ok: false });
  });

  it("enforces empty and size limits", () => {
    expect(validateTemplateFile(new Uint8Array(0), "w.xml", rules("quantower"), L).ok).toBe(false);
    const small = { ...L, maxTemplateFileBytes: 4 };
    expect(validateTemplateFile(strToU8("<x>abc</x>"), "w.xml", rules("quantower"), small).ok).toBe(false);
  });
});

describe("sniff", () => {
  it("recognises common signatures", () => {
    expect(sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(sniff(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe("zip");
    expect(sniff(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe("ole-compound");
    expect(sniff(strToU8("<x/>"))).toBe("unknown");
  });
});

describe("readLimits", () => {
  it("applies overrides within hard caps and ignores junk", () => {
    const l = readLimits({ LIMIT_MAX_TEMPLATE_FILE_BYTES: String(500 * 1024 * 1024), LIMIT_MAX_ZIP_ENTRIES: "50", LIMIT_PER_USER_DAILY_UPLOADS: "-3" });
    expect(l.maxTemplateFileBytes).toBe(20 * 1024 * 1024);
    expect(l.maxZipEntries).toBe(50);
    expect(l.perUserDailyUploads).toBe(DEFAULT_LIMITS.perUserDailyUploads);
  });
});

/** A minimal 64-bit PE image: a DLL unless `exe`, a .NET assembly when `dotnet`. */
function peImage({ exe = false, dotnet = false } = {}): Uint8Array {
  const b = new Uint8Array(0x40 + 24 + 240);
  const v = new DataView(b.buffer);
  b[0] = 0x4d;
  b[1] = 0x5a;
  v.setUint32(0x3c, 0x40, true);
  v.setUint32(0x40, 0x00004550, true);
  v.setUint16(0x44, 0x8664, true);
  v.setUint16(0x40 + 20, 240, true);
  v.setUint16(0x40 + 22, exe ? 0x0022 : 0x2022, true);
  v.setUint16(0x40 + 24, 0x20b, true);
  if (dotnet) v.setUint32(0x40 + 24 + 112 + 14 * 8, 0x2000, true);
  return b;
}

describe("plugins and scripts", () => {
  it("accepts a plugin DLL where the platform allows it and marks it as code", () => {
    const r = validateTemplateFile(peImage({ dotnet: true }), "OrderFlow.dll", rules("atas"), L);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.report.containsCode).toBe(true);
      expect(r.report.detected).toBe("dotnet-dll");
    }
  });

  it("rejects programs renamed to .dll, fake DLLs and DLLs where not allowed", () => {
    const exe = validateTemplateFile(peImage({ exe: true }), "Plugin.dll", rules("atas"), L);
    expect(exe.ok).toBe(false);
    if (!exe.ok) expect(exe.reason).toMatch(/program/);
    expect(validateTemplateFile(strToU8("not a dll"), "Plugin.dll", rules("atas"), L).ok).toBe(false);
    expect(validateTemplateFile(peImage(), "Plugin.dll", rules("tradingview"), L).ok).toBe(false);
  });

  it("accepts a JAR with classes and rejects one hiding native code", () => {
    const cls = new Uint8Array([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 52]);
    const jar = zipSync({ "META-INF/MANIFEST.MF": strToU8("Manifest-Version: 1.0\n"), "com/x/Study.class": cls });
    const ok = validateTemplateFile(jar, "study.jar", rules("motivewave"), L);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.report.containsCode).toBe(true);
    const bad = zipSync({ "com/x/Study.class": cls, "lib/native.bin": peImage() });
    expect(validateTemplateFile(bad, "study.jar", rules("motivewave"), L).ok).toBe(false);
    const noClasses = zipSync({ "readme.txt": strToU8("hi") });
    expect(validateTemplateFile(noClasses, "study.jar", rules("motivewave"), L).ok).toBe(false);
  });

  it("allows DLLs inside ZIPs only for platforms that use them", () => {
    const pkg = zipSync({ "Plugin.dll": peImage(), "readme.txt": strToU8("Install into Indicators.") });
    const ok = validateTemplateFile(pkg, "pack.zip", rules("atas"), L);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.report.containsCode).toBe(true);
    expect(validateTemplateFile(pkg, "pack.zip", rules("tradingview"), L).ok).toBe(false);
    const exeInside = zipSync({ "Plugin.dll": peImage({ exe: true }) });
    expect(validateTemplateFile(exeInside, "pack.zip", rules("atas"), L).ok).toBe(false);
  });

  it("checks Pine Script", () => {
    const pine = strToU8('//@version=6\nindicator("VWAP bands", overlay=true)\nplot(ta.vwap)\n');
    const ok = validateTemplateFile(pine, "vwap.pine", rules("tradingview"), L);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.report.containsCode).toBeFalsy();
    expect(validateTemplateFile(strToU8("hello"), "x.pine", rules("tradingview"), L).ok).toBe(false);
  });
});

describe("other file types", () => {
  it("accepts MotiveWave .tml templates", () => {
    const r = validateTemplateFile(strToU8("<template name='x'/>"), "Scalp.tml", rules("motivewave"), L);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.report.needsReview).toBeFalsy();
  });

  it("accepts unknown types but marks them for a moderator", () => {
    const r = validateTemplateFile(strToU8("settings=1"), "layout.qtw", rules("quantower"), L);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.report.needsReview).toBe(true);
  });

  it("still rejects programs, whatever the name", () => {
    for (const name of ["setup.exe", "run.bat", "x.lnk", "a.msi", "d.iso", "m.xlsm", "s.ps1"]) {
      expect(checkUploadExtension(rules("atas"), name).ok, name).toBe(false);
    }
    expect(validateTemplateFile(peImage({ exe: true }), "harmless.qtw", rules("quantower"), L).ok).toBe(false);
    expect(validateTemplateFile(strToU8("#!/bin/sh\nrm -rf /"), "notes.cfg", rules("quantower"), L).ok).toBe(false);
    expect(validateTemplateFile(zipSync({ "a.xml": strToU8("<a/>") }), "pack.qtw", rules("quantower"), L).ok).toBe(false);
  });

  it("marks ZIPs that hold unknown types and rejects programs inside", () => {
    const ok = validateTemplateFile(zipSync({ "a.qtw": strToU8("x=1"), "readme.txt": strToU8("hi") }), "p.zip", rules("quantower"), L);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.report.needsReview).toBe(true);
    expect(validateTemplateFile(zipSync({ "run.bat": strToU8("echo") }), "p.zip", rules("quantower"), L).ok).toBe(false);
    expect(validateTemplateFile(zipSync({ "a.qtw": peImage({ exe: true }) }), "p.zip", rules("quantower"), L).ok).toBe(false);
  });
});
