import Link from "next/link";
import { requireStaff } from "@/lib/auth";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const viewer = await requireStaff("/admin");
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center gap-3 border-b border-line pb-4">
        <h1 className="text-xl font-semibold text-fg">Admin</h1>
        <span className="rounded bg-surface-2 px-2 py-0.5 text-xs text-fg-muted">{viewer.profile.role}</span>
        <nav aria-label="Admin" className="flex flex-wrap gap-1 text-sm sm:ml-4">
          {[
            ["/admin", "Overview"],
            ["/admin/queue", "Moderation queue"],
            ["/admin/reports", "Reports"],
            ["/admin/users", "Users"],
            ["/admin/audit", "Audit log"],
          ].map(([href, label]) => (
            <Link key={href} href={href} className="rounded px-2.5 py-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg">
              {label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="pt-6">{children}</div>
    </div>
  );
}
