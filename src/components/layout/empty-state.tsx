import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)}>
      {Icon && (
        <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
          <Icon className="size-5" />
        </div>
      )}
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="max-w-[52ch] text-sm text-muted-foreground">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
