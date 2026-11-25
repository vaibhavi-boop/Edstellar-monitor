import * as React from "react";
import { cn } from "@/lib/utils";

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}
export function TableHeader(props: React.ComponentProps<"thead">) {
  return <thead {...props} />;
}
export function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}
export function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("border-b transition-colors hover:bg-surface-muted/50", className)} {...props} />;
}
export function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return <th className={cn("h-9 whitespace-nowrap px-4 text-left text-xs font-medium text-muted-foreground", className)} {...props} />;
}
export function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-4 py-3 align-middle", className)} {...props} />;
}
