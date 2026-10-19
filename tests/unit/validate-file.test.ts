import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { DEFAULT_LIMITS, readLimits } from "@shared/limits.ts";
import { validateTemplateFile, checkTextConfig } from "@shared/validate-file.ts";
import { checkUploadExtension, extensionOf } from "@shared/formats.ts";
import { sniff } from "@shared/magic.ts";

const L = DEFAULT_LIMITS;

describe("format allowlist", () => {
  it("accepts only each platform's formats", () => {
    expect(checkUploadExtension("quantower", "a.xml").ok).toBe(true);
    expect(checkUploadExtension("quantower", "a.mwml").ok).toBe(false);
    expect(checkUploadExtension("sierra-chart", "Layout.Cht").ok).toBe(true);
    expect(checkUploadExtension("motivewave", "x.mwml").ok).toBe(true);
    expect(checkUploadExtension("unknown-platform", "x.xml").ok).toBe(false);
  });

  it("explains blocked types", () => {
    for (const name of ["study.dll", "x.exe", "s.ps1", "i.jar", "Indicator.cs", "Quantower.config", "pic.svg", "page.html"]) {
      const r = checkUploadExtension("quantower", name);
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
    expect(validateTemplateFile(strToU8("<Workspace/>"), "w.xml", "quantower", L).ok).toBe(true);
    expect(validateTemplateFile(strToU8('{"analysis":[]}'), "a.mwml", "motivewave", L).ok).toBe(true);
    expect(validateTemplateFile(new Uint8Array([1, 2, 3, 4, 5]), "c.cht", "sierra-chart", L).ok).toBe(true);
  });

  it("detects spoofed content regardless of extension and MIME", () => {
    const pe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);
    const elf = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2]);
    expect(validateTemplateFile(pe, "c.cht", "sierra-chart", L)).toMatchObject({ ok: false });
    expect(validateTemplateFile(elf, "w.xml", "quantower", L)).toMatchObject({ ok: false });
    expect(validateTemplateFile(strToU8("#!/bin/sh\nrm -rf /"), "c.twconfig", "sierra-chart", L)).toMatchObject({ ok: false });
    expect(validateTemplateFile(strToU8("not a zip"), "p.zip", "quantower", L)).toMatchObject({ ok: false });
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
    expect(validateTemplateFile(good, "pack.zip", "quantower", L).ok).toBe(true);
    const badInner = zipSync({ "w.xml": strToU8('<!DOCTYPE x><x/>') });
    expect(validateTemplateFile(badInner, "pack.zip", "quantower", L)).toMatchObject({ ok: false });
    const wrongPlatform = zipSync({ "a.mwml": strToU8("{}") });
    expect(validateTemplateFile(wrongPlatform, "pack.zip", "quantower", L)).toMatchObject({ ok: false });
  });

  it("enforces empty and size limits", () => {
    expect(validateTemplateFile(new Uint8Array(0), "w.xml", "quantower", L).ok).toBe(false);
    const small = { ...L, maxTemplateFileBytes: 4 };
    expect(validateTemplateFile(strToU8("<x>abc</x>"), "w.xml", "quantower", small).ok).toBe(false);
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
