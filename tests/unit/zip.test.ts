import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { inspectZip, checkEntryPath } from "@shared/zip.ts";

const LIMITS = { maxEntries: 200, maxTotalUncompressedBytes: 100 * 1024 * 1024, maxCompressionRatio: 100, maxPathDepth: 8 };
const XML = strToU8('<?xml version="1.0"?><Workspace/>');
const allowed = ["xml", "txt", "md"];

function cenOffset(zip: Uint8Array): number {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let i = zip.length - 22; i >= 0; i--) if (v.getUint32(i, true) === 0x06054b50) return v.getUint32(i + 16, true);
  throw new Error("no eocd");
}

describe("inspectZip", () => {
  it("accepts a package of allowlisted config files", () => {
    const zip = zipSync({ "layout/workspace.xml": XML, "README.md": strToU8("# Readme") });
    const r = inspectZip(zip, LIMITS, allowed);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entries.map((e) => e.name)).toEqual(["layout/workspace.xml", "README.md"]);
  });

  it("rejects path traversal and absolute paths", () => {
    expect(inspectZip(zipSync({ "../evil.xml": XML }), LIMITS, allowed)).toMatchObject({ ok: false, reason: expect.stringMatching(/traversal/) });
    expect(inspectZip(zipSync({ "a/../../evil.xml": XML }), LIMITS, allowed).ok).toBe(false);
    expect(checkEntryPath("/etc/passwd.xml", 8)).toMatch(/absolute/);
    expect(checkEntryPath("C:/x.xml", 8)).toMatch(/absolute/);
    expect(checkEntryPath("a\\b.xml", 8)).toMatch(/backslash/);
  });

  it("rejects executables, DLLs and scripts inside packages", () => {
    expect(inspectZip(zipSync({ "plugin.dll": strToU8("MZ....") }), LIMITS, allowed)).toMatchObject({ ok: false });
    expect(inspectZip(zipSync({ "run.ps1": strToU8("Write-Host hi") }), LIMITS, allowed)).toMatchObject({ ok: false });
    // Renamed executable: allowed extension, forbidden content.
    const r = inspectZip(zipSync({ "workspace.xml": new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0]) }), LIMITS, allowed);
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/Windows executable/) });
  });

  it("rejects nested archives by name and by content", () => {
    const inner = zipSync({ "a.xml": XML });
    expect(inspectZip(zipSync({ "inner.zip": inner }), LIMITS, allowed)).toMatchObject({ ok: false, reason: expect.stringMatching(/Nested/) });
    expect(inspectZip(zipSync({ "disguised.xml": inner }, { level: 0 }), LIMITS, allowed)).toMatchObject({ ok: false });
  });

  it("rejects encrypted entries", () => {
    const zip = zipSync({ "a.xml": XML });
    const cen = cenOffset(zip);
    zip[cen + 8] |= 0x1; // general purpose flag: encrypted
    expect(inspectZip(zip, LIMITS, allowed)).toMatchObject({ ok: false, reason: expect.stringMatching(/Encrypted/) });
  });

  it("rejects symbolic links", () => {
    const zip = zipSync({ "link.xml": [XML, { os: 3, attrs: (0o120777 << 16) >>> 0 }] });
    expect(inspectZip(zip, LIMITS, allowed)).toMatchObject({ ok: false, reason: expect.stringMatching(/Symbolic/) });
  });

  it("rejects zip bombs by ratio and by total size", () => {
    const zeros = new Uint8Array(5 * 1024 * 1024);
    expect(inspectZip(zipSync({ "big.xml": zeros }, { level: 9 }), LIMITS, allowed)).toMatchObject({ ok: false, reason: expect.stringMatching(/bomb/) });
    const lowTotal = { ...LIMITS, maxCompressionRatio: 1e9, maxTotalUncompressedBytes: 1024 };
    expect(inspectZip(zipSync({ "a.xml": new Uint8Array(4096).fill(60) }), lowTotal, allowed)).toMatchObject({ ok: false, reason: expect.stringMatching(/total size/) });
  });

  it("rejects too many entries and duplicate names", () => {
    const many: Record<string, Uint8Array> = {};
    for (let i = 0; i < 5; i++) many[`f${i}.xml`] = XML;
    expect(inspectZip(zipSync(many), { ...LIMITS, maxEntries: 4 }, allowed).ok).toBe(false);
    expect(inspectZip(zipSync({ "A.xml": XML, "a.xml": XML }), LIMITS, allowed)).toMatchObject({ ok: false, reason: expect.stringMatching(/duplicate/) });
  });

  it("rejects malformed and truncated archives", () => {
    const zip = zipSync({ "a.xml": XML });
    expect(inspectZip(zip.subarray(0, zip.length - 10), LIMITS, allowed).ok).toBe(false);
    expect(inspectZip(new Uint8Array(10), LIMITS, allowed).ok).toBe(false);
    const corrupt = zip.slice();
    corrupt[40] ^= 0xff; // flip a data byte → CRC or inflate failure
    expect(inspectZip(corrupt, LIMITS, allowed).ok).toBe(false);
    const badLocal = zip.slice();
    badLocal[8] = 99; // local header method disagrees with central directory
    expect(inspectZip(badLocal, LIMITS, allowed).ok).toBe(false);
  });

  it("runs the inner content check", () => {
    const r = inspectZip(zipSync({ "a.xml": XML }), LIMITS, allowed, () => "bad inner");
    expect(r).toMatchObject({ ok: false, reason: "bad inner" });
  });
});
