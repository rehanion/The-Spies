// Plain badges with no data access: usable from server and client components.
import type { Database } from "@/lib/database.types";

type Tone = "neutral" | "accent" | "ok" | "warn" | "danger" | "info";

const TONES: Record<Tone, string> = {
  neutral: "border-line-strong bg-surface-2 text-fg-muted",
  accent: "border-accent/40 bg-accent/10 text-accent",
  ok: "border-ok/40 bg-ok/10 text-ok",
  warn: "border-warn/40 bg-warn/10 text-warn",
  danger: "border-danger/40 bg-danger/10 text-danger",
  info: "border-info/40 bg-info/10 text-info",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium leading-4 tracking-wide ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function DemoBadge() {
  return (
    <Badge tone="info" title="Sample listing for development. Not real community activity.">
      Demo
    </Badge>
  );
}

type PubStatus = Database["public"]["Enums"]["publication_status"];
const PUB: Record<PubStatus, { tone: Tone; label: string }> = {
  draft: { tone: "neutral", label: "Draft" },
  pending: { tone: "warn", label: "Pending review" },
  approved: { tone: "ok", label: "Approved" },
  rejected: { tone: "danger", label: "Rejected" },
  removed: { tone: "danger", label: "Removed" },
};
export function PublicationBadge({ status }: { status: PubStatus }) {
  const s = PUB[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

type ScanStatus = Database["public"]["Enums"]["scan_status"];
const SCAN: Record<ScanStatus, { tone: Tone; label: string }> = {
  pending: { tone: "warn", label: "Scan pending" },
  clean: { tone: "ok", label: "ClamAV scan passed" },
  flagged: { tone: "danger", label: "Flagged by scanner" },
  error: { tone: "danger", label: "Scan error" },
};
export function ScanBadge({ status }: { status: ScanStatus }) {
  const s = SCAN[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

type ValidationStatus = Database["public"]["Enums"]["validation_status"];
const VAL: Record<ValidationStatus, { tone: Tone; label: string }> = {
  pending: { tone: "warn", label: "Validating" },
  passed: { tone: "ok", label: "Structure valid" },
  failed: { tone: "danger", label: "Rejected file" },
};
export function ValidationBadge({ status }: { status: ValidationStatus }) {
  const s = VAL[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
