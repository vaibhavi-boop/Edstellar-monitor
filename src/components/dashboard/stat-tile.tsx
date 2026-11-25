import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "danger" | "warning" | "success";
}) {
  return (
    <div className="flex flex-col gap-1 px-5 py-4">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-[22px] font-semibold leading-tight tracking-[-0.01em]",
          tone === "danger" && value !== "0" && value !== "—" && "text-destructive",
          tone === "warning" && value !== "0" && value !== "—" && "text-warning",
          tone === "success" && value !== "0" && value !== "—" && "text-success",
        )}
      >
        {value}
      </dd>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
