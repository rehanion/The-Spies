"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteSubmission, submitForReview, withdrawSubmission } from "@/app/dashboard/actions";

export function SubmissionActions({
  templateId,
  status,
  canSubmit,
}: {
  templateId: string;
  status: string;
  canSubmit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; message: string } | null>) =>
    start(async () => {
      const res = await fn();
      if (res) setMsg({ ok: res.ok, text: res.message });
      router.refresh();
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {status === "draft" || status === "rejected" ? (
          <button type="button" className="btn btn-primary" disabled={pending || !canSubmit} onClick={() => run(() => submitForReview(templateId))}>
            {status === "rejected" ? "Resubmit for review" : "Submit for review"}
          </button>
        ) : null}
        {status === "approved" || status === "pending" ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={pending}
            onClick={() => {
              if (window.confirm("Withdraw this listing? It will no longer be public or downloadable.")) run(() => withdrawSubmission(templateId));
            }}
          >
            Withdraw listing
          </button>
        ) : null}
        {status === "draft" || status === "pending" || status === "rejected" ? (
          <button
            type="button"
            className="btn btn-danger"
            disabled={pending}
            onClick={() => {
              if (window.confirm("Delete this submission and all its files permanently?")) run(() => deleteSubmission(templateId));
            }}
          >
            Delete
          </button>
        ) : null}
      </div>
      {msg ? <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p> : null}
    </div>
  );
}
