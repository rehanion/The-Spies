export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-sm font-medium text-fg">{title}</p>
      {children ? <div className="max-w-md text-sm text-fg-muted">{children}</div> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "danger" | "ok";
  title?: string;
  children: React.ReactNode;
}) {
  const tones = {
    info: "border-info/40 bg-info/5",
    warn: "border-warn/40 bg-warn/5",
    danger: "border-danger/40 bg-danger/5",
    ok: "border-ok/40 bg-ok/5",
  } as const;
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`rounded-md border px-4 py-3 text-sm ${tones[tone]}`}>
      {title ? <p className="mb-0.5 font-medium text-fg">{title}</p> : null}
      <div className="text-fg-muted">{children}</div>
    </div>
  );
}
