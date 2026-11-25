"use client";
import { useActionState, useState, useTransition } from "react";
import { Pause, Play, Trash2 } from "lucide-react";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { deleteWebsite, setWebsiteStatus } from "@/server/websites/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { describe, Field, FormMessage, SubmitButton } from "@/components/ui/form";

export function WebsiteDangerZone({ website }: { website: { id: string; name: string; domain: string; status: "ACTIVE" | "PAUSED" } }) {
  const [statusState, setStatusState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  const [deleteState, deleteAction] = useActionState(deleteWebsite.bind(null, website.id), initialActionState);
  const paused = website.status === "PAUSED";

  return (
    <div className="divide-y">
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">{paused ? "Resume monitoring" : "Pause monitoring"}</p>
          <p className="text-[13px] text-muted-foreground">
            {paused ? "Scheduled runs will check this website again." : "Scheduled runs skip this website. History and settings are kept."}
          </p>
          {statusState.message && <div className="mt-2"><FormMessage state={statusState} /></div>}
        </div>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => startTransition(async () => setStatusState(await setWebsiteStatus(website.id, paused ? "ACTIVE" : "PAUSED")))}
        >
          {paused ? <Play /> : <Pause />}
          {paused ? "Resume monitoring" : "Pause monitoring"}
        </Button>
      </div>
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">Delete website</p>
          <p className="text-[13px] text-muted-foreground">Removes the website with all discovered URLs, issues and run history.</p>
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive-soft">
              <Trash2 /> Delete website
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>Delete {website.name}?</DialogTitle>
            <DialogDescription>
              This permanently deletes every URL, issue, run and report for {website.domain}. It cannot be undone.
            </DialogDescription>
            <form action={deleteAction} className="mt-5 flex flex-col gap-4" noValidate>
              <FormMessage state={deleteState} />
              <Field id="confirm" label={<>Type <span className="font-mono">{website.domain}</span> to confirm</>} errors={deleteState.fieldErrors?.confirm}>
                <Input {...describe("confirm", deleteState)} autoComplete="off" spellCheck={false} />
              </Field>
              <SubmitButton variant="destructive" pendingText="Deleting…">
                Delete website
              </SubmitButton>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
