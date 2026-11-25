export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="#2347d1" />
        <path d="M6 18h5l3-8 4 13 3-7h5" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="leading-tight">
        <p className="text-[14px] font-semibold text-white">Edstellar Monitor</p>
        <p className="text-[11.5px] text-rail-muted">Website health</p>
      </div>
    </div>
  );
}
