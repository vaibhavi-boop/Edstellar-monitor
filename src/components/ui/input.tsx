import * as React from "react";
import { cn } from "@/lib/utils";

export const fieldClass =
  "w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground/70 disabled:opacity-60 aria-[invalid=true]:border-destructive";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(fieldClass, "h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(fieldClass, "min-h-24 py-2 font-mono text-[13px] leading-relaxed", className)} {...props} />;
}

export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn(fieldClass, "h-9 pr-8", className)} {...props} />;
}

export function Checkbox({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  return <input type="checkbox" className={cn("size-4 rounded border-input accent-[var(--primary)]", className)} {...props} />;
}
