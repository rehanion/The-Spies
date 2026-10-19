export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-12">
      <h1 className="text-2xl font-semibold text-fg">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-fg-muted">{subtitle}</p> : null}
      <div className="card mt-6 p-5">{children}</div>
      {footer ? <div className="mt-4 text-center text-sm text-fg-muted">{footer}</div> : null}
    </div>
  );
}
