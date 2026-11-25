import type { HealthScore } from "@/lib/health-score";
import { HEALTH_WEIGHTS } from "@/lib/health-score";

/**
 * The health score as a ring split into its three parts, so the number and
 * the reason for it are read together.
 */
export function HealthDial({ health }: { health: HealthScore | null }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const sslWeight = health?.ssl === null ? 0 : HEALTH_WEIGHTS.ssl;
  const total = HEALTH_WEIGHTS.availability + HEALTH_WEIGHTS.issues + sslWeight;
  const segments = health
    ? [
        { value: health.availability, max: HEALTH_WEIGHTS.availability, color: "var(--primary)" },
        { value: health.issues, max: HEALTH_WEIGHTS.issues, color: "var(--success)" },
        ...(health.ssl === null ? [] : [{ value: health.ssl, max: HEALTH_WEIGHTS.ssl, color: "var(--warning)" }]),
      ]
    : [];
  const gap = 4;
  let offset = 0;

  const tone =
    health == null ? "text-muted-foreground" : health.score >= 90 ? "text-success" : health.score >= 70 ? "text-warning" : "text-destructive";

  return (
    <div className="relative size-40 shrink-0">
      <svg viewBox="0 0 128 128" className="size-full -rotate-90" role="img" aria-label={health ? `Health score ${health.score} out of 100` : "Health score not available yet"}>
        <circle cx="64" cy="64" r={r} fill="none" stroke="var(--surface-muted)" strokeWidth="10" />
        {segments.map((s, i) => {
          const span = (s.max / total) * c - gap;
          const filled = Math.max(0, (s.value / s.max) * span);
          const el = (
            <g key={i}>
              <circle cx="64" cy="64" r={r} fill="none" stroke={s.color} strokeOpacity="0.18" strokeWidth="10" strokeDasharray={`${span} ${c}`} strokeDashoffset={-offset} />
              <circle cx="64" cy="64" r={r} fill="none" stroke={s.color} strokeWidth="10" strokeDasharray={`${filled} ${c}`} strokeDashoffset={-offset} />
            </g>
          );
          offset += span + gap;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-[40px] font-semibold leading-none tracking-[-0.03em] ${tone}`}>{health ? health.score : "—"}</span>
        <span className="mt-1 text-xs text-muted-foreground">out of 100</span>
      </div>
    </div>
  );
}
