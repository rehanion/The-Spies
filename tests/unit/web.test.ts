import { describe, expect, it } from "vitest";
import { contentDisposition, sanitizeFilename } from "@shared/filename.ts";
import { safeNextPath } from "@/lib/safe-redirect";
import { computeDownloadState, type FileGateInput } from "@/lib/download-state";
import { slugify } from "@/lib/slug";
import { UploadError, precheckUpload } from "@/lib/uploads";

describe("sanitizeFilename", () => {
  it("strips paths, control and bidi characters", () => {
    expect(sanitizeFilename("../../etc/passwd.xml")).toBe("passwd.xml");
    expect(sanitizeFilename("C:\\Users\\x\\a.xml")).toBe("a.xml");
    expect(sanitizeFilename("evil\u202Elmx.exe")).toBe("evillmx.exe");
    expect(sanitizeFilename("a<b>:c.xml")).toBe("a_b__c.xml");
    expect(sanitizeFilename("con.xml")).toBe("_con.xml");
    expect(sanitizeFilename("..")).toBeNull();
    expect(sanitizeFilename("")).toBeNull();
  });
  it("builds a safe Content-Disposition", () => {
    const v = contentDisposition('na"me\\ü.xml');
    expect(v).toContain('filename="na_me__.xml"');
    expect(v).toContain("filename*=UTF-8''");
    expect(v).not.toMatch(/[\r\n]/);
  });
});

describe("safeNextPath", () => {
  it("allows same-origin paths only", () => {
    expect(safeNextPath("/t/abc?x=1")).toBe("/t/abc?x=1");
    expect(safeNextPath("/a/../t/abc")).toBe("/t/abc");
    for (const bad of [
      "https://evil.test", "//evil.test", "/\\evil.test", "javascript:alert(1)", "/a\nb", "", null, 5,
      "/.//evil.test", "/..//evil.test", "/a/..//evil.test", "/%2e//evil.test", "/%2e%2e//evil.test",
    ]) {
      expect(safeNextPath(bad, "/fallback")).toBe("/fallback");
    }
  });
});

describe("computeDownloadState", () => {
  const ok: FileGateInput = { is_current: true, validation_status: "passed", sha256: "a", scan_status: "clean", scanned_sha256: "a", approved_sha256: "a" };
  it("requires approval, a clean scan and matching hashes", () => {
    expect(computeDownloadState("approved", ok)).toBe("ok");
    expect(computeDownloadState("pending", ok)).toBe("template_not_approved");
    expect(computeDownloadState("approved", { ...ok, is_current: false })).toBe("file_superseded");
    expect(computeDownloadState("approved", { ...ok, scan_status: "pending" })).toBe("scan_pending");
    expect(computeDownloadState("approved", { ...ok, scan_status: "flagged" })).toBe("scan_flagged");
    expect(computeDownloadState("approved", { ...ok, scanned_sha256: "b" })).toBe("hash_mismatch");
    expect(computeDownloadState("approved", { ...ok, approved_sha256: "b" })).toBe("not_approved_version");
  });
});

describe("slugify", () => {
  it("produces url-safe slugs", () => {
    expect(slugify("ES Footprint — Order Flow!!")).toMatch(/^[a-z0-9-]+$/);
    expect(slugify("   ")).toBeTruthy();
  });
});

describe("precheckUpload", () => {
  const rules = { upload: ["xml", "zip", "other"], zipInner: ["xml", "other"] };
  it("refuses file types that can run code but have no magic bytes", () => {
    for (const name of ["notes.one", "macro.accdb", "page.mhtml", "a.settingcontent-ms", "x.sct", "doc.rtf", "q.iqy"]) {
      expect(() => precheckUpload({ kind: "file", filename: name, size: 10 }, rules), name).toThrow(UploadError);
    }
  });
  it("still accepts template and other plain files", () => {
    expect(precheckUpload({ kind: "file", filename: "layout.xml", size: 10 }, rules).extension).toBe("xml");
    expect(precheckUpload({ kind: "file", filename: "readme.csv", size: 10 }, rules).extension).toBe("csv");
  });
});
