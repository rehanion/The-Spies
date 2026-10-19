import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Acceptable use rules" };

export default function RulesPage() {
  return (
    <article className="prose-plain mx-auto max-w-3xl space-y-6 px-4 py-8 text-sm leading-6 text-fg-muted">
      <h1 className="text-2xl font-semibold text-fg">Acceptable use rules</h1>
      <p>
        SPIES is a free community library of chart templates, workspaces and layouts for trading platforms. These rules keep it safe and useful.
        By creating an account you agree to them. Moderators may remove content or suspend accounts that break them.
      </p>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-fg">What you may upload</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Configuration files for a supported platform, in an accepted format, that you created or have the right to share.</li>
          <li>Screenshots of the template in use. Hide account numbers, balances, positions and any personal information first.</li>
          <li>An honest title and description. Say what the template does, which platform version it was built with and any data or study it relies on.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-fg">What you may not upload</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Executable code of any kind: programs, installers, scripts, compiled plugins (.dll, .jar) or source code that must be compiled.</li>
          <li>Files containing credentials, license keys, broker connection settings or personal data. Platform backups often contain these, so export only the template.</li>
          <li>Paid or licensed work you do not own, including commercial indicators or another creator&apos;s templates.</li>
          <li>Market data files, malware, deliberately broken files or anything designed to harm a user or their computer.</li>
          <li>Promises of profit, trading signals sold as guarantees, spam, referral links or advertising.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-fg">Reviews and community conduct</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Review a template only after trying it. One review per template; you cannot review your own work.</li>
          <li>No harassment, hate, threats or personal attacks.</li>
          <li>No fake accounts, vote manipulation or automated downloading to inflate counts. Download counts are de-duplicated and suspicious activity is ignored.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-fg">Using downloaded templates</h2>
        <p>
          Templates are shared by community members, as-is, for educational use. They are not trading advice. Nothing is installed automatically: you choose
          whether to import a file into your own platform. Read <Link href="/security" className="underline">how files are checked</Link> before you do.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-fg">Enforcement</h2>
        <p>
          Moderators can reject or remove listings, delete reviews and suspend accounts. Every moderation action is recorded in an audit log. To report a
          problem use the <Link href="/report" className="underline">report form</Link>; for copyright issues use the <Link href="/copyright" className="underline">copyright form</Link>.
        </p>
      </section>
    </article>
  );
}
