export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
        <rect x="1.5" y="1.5" width="21" height="21" rx="4" className="stroke-accent" strokeWidth="1.5" />
        <path d="M5 15.5 9 11l3 3 7-7" className="stroke-fg" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="19" cy="7" r="1.6" className="fill-accent" />
      </svg>
      <span className="font-mono text-[15px] font-semibold tracking-[0.18em] text-fg">SPIES</span>
    </span>
  );
}
