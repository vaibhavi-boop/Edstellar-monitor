"use client";
import type { IssueStatus } from "@/generated/prisma/enums";
import { changeIssueStatus } from "@/server/issues/actions";
import { NativeSelect, Textarea } from "@/components/ui/input";
import { describe, Field, FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";

const CHOICES: Array<[IssueStatus, string]> = [
  ["OPEN", "Open"],
  ["IN_PROGRESS", "In progress"],
  ["RESOLVED", "Resolved"],
  ["IGNORED", "Ignored (stop counting it)"],
];

export function IssueStatusForm({ issueId, status }: { issueId: string; status: IssueStatus }) {
  const { state, onSubmit, pending } = useFormAction(changeIssueStatus.bind(null, issueId));
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <FormMessage state={state} />
      <Field id="status" label="Status" errors={state.fieldErrors?.status}>
        <NativeSelect {...describe("status", state)} defaultValue={status === "NEW" ? "OPEN" : status}>
          {CHOICES.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="note" label="Note (optional)" hint="Saved in the issue history, e.g. who is fixing it or why it is ignored." errors={state.fieldErrors?.note}>
        <Textarea {...describe("note", state)} maxLength={500} className="min-h-20" />
      </Field>
      <SubmitButton pending={pending} pendingText="Saving…" className="self-start">Save</SubmitButton>
      <p className="text-[13px] text-muted-foreground">
        Resolved issues reopen automatically if a later run finds them again. Ignored issues stay ignored.
      </p>
    </form>
  );
}
