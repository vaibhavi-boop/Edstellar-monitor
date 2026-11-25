"use client";
import * as React from "react";
import { startTransition, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { Button, type ButtonProps } from "./button";
import { Label } from "./label";

export function SubmitButton({
  children,
  pendingText,
  pending: pendingProp,
  ...props
}: ButtonProps & { pendingText?: string; pending?: boolean }) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending && <Loader2 className="animate-spin" />}
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}

export function Field({
  id,
  label,
  hint,
  errors,
  children,
  className,
}: {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  errors?: string[];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {errors?.length ? (
        <p id={`${id}-error`} className="text-[13px] text-destructive">
          {errors.join(" ")}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[13px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Props that wire an input to its error/hint text for screen readers. */
export function describe(id: string, state: ActionState, name = id) {
  const invalid = Boolean(state.fieldErrors?.[name]?.length);
  return { id, name, "aria-invalid": invalid || undefined, "aria-describedby": invalid ? `${id}-error` : `${id}-hint` };
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;
  const ok = state.ok === true;
  return (
    <div
      role={ok ? "status" : "alert"}
      className={cn(
        "flex items-start gap-2 rounded-md px-3 py-2 text-sm",
        ok ? "bg-success-soft text-success" : "bg-destructive-soft text-destructive",
      )}
    >
      {ok ? <CircleCheck className="mt-0.5 size-4 shrink-0" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" />}
      <span>{state.message}</span>
    </div>
  );
}

/**
 * Runs a server action from onSubmit instead of the form's action prop, so a
 * failed validation does not reset what the user typed (React resets forms
 * submitted through the action prop).
 */
export function useFormAction(fn: (prev: ActionState, form: FormData) => Promise<ActionState>) {
  const [state, dispatch, pending] = useActionState(fn, initialActionState);
  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  };
  return { state, onSubmit, pending };
}
