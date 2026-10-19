// Mirrors public.file_download_state() for display purposes only. The download
// route always asks the database; this function just picks the message shown.

export type DownloadState =
  | "ok"
  | "not_found"
  | "template_not_approved"
  | "creator_unavailable"
  | "file_superseded"
  | "validation_not_passed"
  | "scan_pending"
  | "scan_flagged"
  | "scan_error"
  | "scan_unavailable"
  | "hash_mismatch"
  | "not_approved_version";

export interface FileGateInput {
  is_current: boolean;
  validation_status: "pending" | "passed" | "failed";
  sha256: string | null;
  scan_status: "pending" | "clean" | "flagged" | "error";
  scanned_sha256: string | null;
  approved_sha256: string | null;
}

export function computeDownloadState(templateStatus: string, f: FileGateInput): DownloadState {
  if (templateStatus !== "approved") return "template_not_approved";
  if (!f.is_current) return "file_superseded";
  if (f.validation_status !== "passed" || !f.sha256) return "validation_not_passed";
  if (f.scan_status === "pending") return "scan_pending";
  if (f.scan_status === "flagged") return "scan_flagged";
  if (f.scan_status === "error") return "scan_error";
  if (f.scan_status !== "clean") return "scan_unavailable";
  if (!f.scanned_sha256 || f.scanned_sha256 !== f.sha256) return "hash_mismatch";
  if (!f.approved_sha256 || f.approved_sha256 !== f.sha256) return "not_approved_version";
  return "ok";
}

export const DOWNLOAD_STATE_MESSAGES: Record<DownloadState, string> = {
  ok: "Available",
  not_found: "File not found.",
  template_not_approved: "Unavailable until this listing is published.",
  creator_unavailable: "Unavailable: the creator's account is suspended.",
  file_superseded: "This version was replaced and is no longer available.",
  validation_not_passed: "Unavailable: the file has not passed structural validation.",
  scan_pending: "Unavailable: waiting for a malware scan.",
  scan_flagged: "Unavailable: the malware scanner flagged this file.",
  scan_error: "Unavailable: the scan failed or the scanned file did not match the stored file.",
  scan_unavailable: "Unavailable: no accepted scan result.",
  hash_mismatch: "Unavailable: the scanned file's hash does not match the stored object.",
  not_approved_version: "Unavailable: this exact file version has not been approved.",
};
