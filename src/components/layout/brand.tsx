/** Edstellar Monitor mark: a heartbeat line in navy on the Edstellar lime. */
export function BrandMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M6 18h5l3-8 4 13 3-7h5" fill="none" stroke="var(--accent-foreground)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark />
      <div className="leading-tight">
        <p className="font-[family-name:var(--font-heading)] text-[14px] font-semibold tracking-[-0.01em] text-white">Edstellar Monitor</p>
        <p className="text-[11.5px] text-rail-muted">Website health</p>
      </div>
    </div>
  );
}
