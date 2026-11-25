"use client";
import { useActionState } from "react";
import { initialActionState } from "@/lib/action-state";
import { login } from "@/server/auth/actions";
import { Input } from "@/components/ui/input";
import { describe, Field, FormMessage, SubmitButton } from "@/components/ui/form";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(login, initialActionState);
  return (
    <form action={action} className="mt-6 flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="next" value={next ?? "/"} />
      <Field id="email" label="Email" errors={state.fieldErrors?.email}>
        <Input {...describe("email", state)} type="email" autoComplete="username" required autoFocus defaultValue={state.values?.email} key={state.values?.email} />
      </Field>
      <Field id="password" label="Password" errors={state.fieldErrors?.password}>
        <Input {...describe("password", state)} type="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton className="mt-2 w-full" pendingText="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}
