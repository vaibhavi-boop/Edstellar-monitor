"use client";
import { useTransition } from "react";
import { Globe } from "lucide-react";
import { selectWebsite } from "@/server/websites/actions";

export function WebsiteSwitcher({
  websites,
  activeId,
}: {
  websites: Array<{ id: string; name: string; domain: string; status: string }>;
  activeId: string | null;
}) {
  const [pending, startTransition] = useTransition();
  if (websites.length === 0) return null;
  return (
    <label className="flex min-w-0 items-center gap-2 rounded-md border bg-surface px-2.5 text-sm">
      <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">Website</span>
      <select
        className="h-8 min-w-0 max-w-56 truncate bg-transparent pr-1 font-medium outline-none disabled:opacity-60"
        value={activeId ?? ""}
        disabled={pending || websites.length < 2}
        onChange={(e) => startTransition(() => selectWebsite(e.target.value))}
      >
        {websites.map((w) => (
          <option key={w.id} value={w.id}>
            {w.domain}
            {w.status === "PAUSED" ? " (paused)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
