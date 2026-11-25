"use client";
import { useEffect, useState } from "react";

/**
 * Timestamps are stored in UTC and rendered in the viewer's time zone. The
 * server renders a UTC fallback; the browser swaps in local time after mount.
 */
export function LocalTime({ value, mode = "datetime" }: { value: Date | string | null | undefined; mode?: "datetime" | "date" | "relative" }) {
  const [text, setText] = useState<string | null>(null);
  const iso = value ? new Date(value).toISOString() : null;

  useEffect(() => {
    if (!iso) return;
    const date = new Date(iso);
    if (mode === "relative") {
      const diff = (date.getTime() - Date.now()) / 1000;
      const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
      const abs = Math.abs(diff);
      setText(
        abs < 60 ? rtf.format(Math.round(diff), "second")
        : abs < 3600 ? rtf.format(Math.round(diff / 60), "minute")
        : abs < 86400 ? rtf.format(Math.round(diff / 3600), "hour")
        : rtf.format(Math.round(diff / 86400), "day"),
      );
    } else {
      setText(
        new Intl.DateTimeFormat(undefined, mode === "date" ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" }).format(date),
      );
    }
  }, [iso, mode]);

  if (!iso) return <span className="text-muted-foreground">—</span>;
  return (
    <time dateTime={iso} title={iso} suppressHydrationWarning>
      {text ?? `${iso.slice(0, 16).replace("T", " ")} UTC`}
    </time>
  );
}
