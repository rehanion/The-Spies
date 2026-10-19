"use client";

import { useActionState, useState, useTransition } from "react";
import { cleanupStaleUploads, moderate, recordScan, resolveReport, setUserBanned, setUserRole, type AdminState } from "@/app/admin/actions";

function Result({ state }: { state: AdminState }) {
  if (!state) return null;
  return <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-ok" : "text-danger"}`}>{state.message}</p>;
}

export function ScanForm({ fileId, templateId, expectedSha256 }: { fileId: string; templateId: string; expectedSha256: string }) {
  const [state, action, pending] = useActionState(recordScan, null);
  const [now] = useState(() => new Date().toISOString().slice(0, 16));
  return (
    <form action={action} className="mt-3 grid gap-3 rounded-md border border-line bg-surface-2 p-3 sm:grid-cols-2">
      <input type="hidden" name="fileId" value={fileId} />
      <input type="hidden" name="templateId" value={templateId} />
      <p className="text-xs text-fg-muted sm:col-span-2">
        Record the result of scanning the <strong>exact downloaded object</strong>. The SHA-256 you enter is compared with the
        server-computed hash <span className="break-all font-mono">{expectedSha256}</span>; a mismatch is stored as a scan error.
      </p>
      <div>
        <label className="label" htmlFor={`r-${fileId}`}>Result</label>
        <select id={`r-${fileId}`} name="result" className="input" defaultValue="clean">
          <option value="clean">Clean (no detections)</option>
          <option value="flagged">Flagged (detection found)</option>
          <option value="error">Error / inconclusive</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor={`n-${fileId}`}>Scanner</label>
        <input id={`n-${fileId}`} name="scannerName" defaultValue="ClamAV" className="input" required maxLength={60} />
      </div>
      <div>
        <label className="label" htmlFor={`v-${fileId}`}>Engine version</label>
        <input id={`v-${fileId}`} name="scannerVersion" placeholder="e.g. 1.5.4" className="input" required maxLength={120} />
      </div>
      <div>
        <label className="label" htmlFor={`s-${fileId}`}>Signature database</label>
        <input id={`s-${fileId}`} name="signatureVersion" placeholder="e.g. daily 27801 / Mon Oct 19 2026" className="input" required maxLength={200} />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor={`h-${fileId}`}>SHA-256 of the scanned file</label>
        <input id={`h-${fileId}`} name="sha256" className="input font-mono text-xs" required pattern="[0-9a-fA-F]{64}" placeholder="Output of sha256sum / Get-FileHash" />
      </div>
      <div>
        <label className="label" htmlFor={`t-${fileId}`}>Scanned at (your local time)</label>
        <input id={`t-${fileId}`} name="scannedAt" type="datetime-local" defaultValue={now} className="input" required />
      </div>
      <div>
        <label className="label" htmlFor={`o-${fileId}`}>Notes</label>
        <input id={`o-${fileId}`} name="notes" maxLength={2000} className="input" />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor={`raw-${fileId}`}>Scanner output (optional)</label>
        <textarea id={`raw-${fileId}`} name="rawOutput" rows={3} maxLength={8000} className="input font-mono text-xs" />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Recording…" : "Record scan result"}</button>
        <Result state={state} />
      </div>
    </form>
  );
}

export function ModerationForm({ templateId, status, canApprove }: { templateId: string; status: string; canApprove: boolean }) {
  const [state, action, pending] = useActionState(moderate, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="templateId" value={templateId} />
      <div>
        <label htmlFor="reason" className="label">Reason / note to creator</label>
        <textarea id="reason" name="reason" rows={3} maxLength={2000} className="input" placeholder="Required for reject and remove" />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="action" value="approve" className="btn btn-primary" disabled={pending || !canApprove || status === "approved"}>
          Approve &amp; publish
        </button>
        <button type="submit" name="action" value="reject" className="btn btn-secondary" disabled={pending || status === "rejected"}>
          Reject
        </button>
        <button type="submit" name="action" value="remove" className="btn btn-danger" disabled={pending || status === "removed"}>
          Remove
        </button>
      </div>
      {!canApprove && status !== "approved" ? (
        <p className="text-xs text-warn">Approval is disabled until every current file has passed validation and has a clean scan whose hash matches the stored object.</p>
      ) : null}
      <Result state={state} />
    </form>
  );
}

export function ReportResolveForm({ reportId }: { reportId: string }) {
  const [state, action, pending] = useActionState(resolveReport, null);
  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="reportId" value={reportId} />
      <label className="sr-only" htmlFor={`note-${reportId}`}>Resolution note</label>
      <input id={`note-${reportId}`} name="note" placeholder="Resolution note" className="input h-8 max-w-xs py-1 text-xs" maxLength={2000} />
      <button type="submit" name="status" value="resolved" className="btn btn-secondary h-8 px-2.5 text-xs" disabled={pending}>Mark resolved</button>
      <button type="submit" name="status" value="dismissed" className="btn btn-ghost h-8 px-2.5 text-xs" disabled={pending}>Dismiss</button>
      <Result state={state} />
    </form>
  );
}

export function UserControls({ userId, role, banned, viewerIsAdmin }: { userId: string; role: string; banned: boolean; viewerIsAdmin: boolean }) {
  const [roleState, roleAction, rolePending] = useActionState(setUserRole, null);
  const [banState, banAction, banPending] = useActionState(setUserBanned, null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {viewerIsAdmin ? (
        <form action={roleAction} className="flex items-center gap-1">
          <input type="hidden" name="userId" value={userId} />
          <label className="sr-only" htmlFor={`role-${userId}`}>Role</label>
          <select id={`role-${userId}`} name="role" defaultValue={role} className="input h-8 w-auto py-1 text-xs">
            <option value="user">user</option>
            <option value="moderator">moderator</option>
            <option value="admin">admin</option>
          </select>
          <button type="submit" className="btn btn-ghost h-8 px-2 text-xs" disabled={rolePending}>Set role</button>
        </form>
      ) : null}
      <form action={banAction}>
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="banned" value={banned ? "false" : "true"} />
        <button type="submit" className={`btn h-8 px-2 text-xs ${banned ? "btn-secondary" : "btn-danger"}`} disabled={banPending}>
          {banned ? "Lift suspension" : "Suspend"}
        </button>
      </form>
      <Result state={roleState ?? banState} />
    </div>
  );
}

export function CleanupButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<AdminState>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => start(async () => setMsg(await cleanupStaleUploads()))}>
        Clean up abandoned uploads
      </button>
      <Result state={msg} />
    </div>
  );
}
