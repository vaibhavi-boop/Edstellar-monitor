"use client";
import { useEffect } from "react";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center">
      <CircleAlert className="size-8 text-destructive" />
      <h1 className="text-lg font-semibold">This page could not load</h1>
      <p className="text-sm text-muted-foreground">
        The server returned an error, often because the database is unreachable. Check the connection and try again.
        {error.digest && <span className="mt-2 block font-mono text-xs">Reference: {error.digest}</span>}
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
