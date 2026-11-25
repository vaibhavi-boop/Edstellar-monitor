"use client";
import { useState, useTransition } from "react";
import { ChevronDown, Loader2, Play } from "lucide-react";
import type { ActionState } from "@/lib/action-state";
import { requestRun } from "@/server/runs/actions";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** Queues a run for the website. The worker (loop mode, --queue or the schedule) runs it. */
export function RunNowButton({ websiteId }: { websiteId: string }) {
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();
  const queue = (scan: "FULL" | "INCREMENTAL") => start(async () => setState(await requestRun(websiteId, scan)));
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex">
        <Button className="rounded-r-none" disabled={pending} onClick={() => queue("FULL")}>
          {pending ? <Loader2 className="animate-spin" /> : <Play />} Run now
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="rounded-l-none border-l border-primary-foreground/20 px-2" disabled={pending} aria-label="More run options">
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => queue("FULL")}>Full scan: sitemaps, links, every URL</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => queue("INCREMENTAL")}>Incremental: re-check known URLs</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {state.message && <div className="max-w-md"><FormMessage state={state} /></div>}
    </div>
  );
}
