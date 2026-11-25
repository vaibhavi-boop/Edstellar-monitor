"use client";
import { useState, useTransition } from "react";
import { Loader2, Play, Trash2 } from "lucide-react";
import type { ActionState } from "@/lib/action-state";
import { checkApiEndpointNow, deleteApiEndpoint } from "@/server/api-endpoints/actions";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function CheckNowButton({ endpointId }: { endpointId: string }) {
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col items-end gap-2">
      <Button variant="outline" disabled={pending} onClick={() => start(async () => setState(await checkApiEndpointNow(endpointId)))}>
        {pending ? <Loader2 className="animate-spin" /> : <Play />} Check now
      </Button>
      {state.message && (
        <div className="max-w-sm">
          <FormMessage state={state} />
        </div>
      )}
    </div>
  );
}

export function DeleteEndpointButton({ endpointId, name }: { endpointId: string; name: string }) {
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" className="text-destructive">
          <Trash2 /> Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
        <AlertDialogDescription>
          Its check history and stored credentials are deleted. Open issues for this endpoint are marked resolved with a note. This cannot be undone.
        </AlertDialogDescription>
        <FormMessage state={state} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            className="bg-destructive text-white hover:opacity-90"
            onClick={(ev) => {
              ev.preventDefault();
              start(async () => setState(await deleteApiEndpoint(endpointId)));
            }}
          >
            {pending && <Loader2 className="animate-spin" />} Delete endpoint
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
