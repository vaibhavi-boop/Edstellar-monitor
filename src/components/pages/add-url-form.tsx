"use client";
import { useEffect, useRef } from "react";
import { addManualUrl } from "@/server/pages/actions";
import { Input } from "@/components/ui/input";
import { describe, Field, FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";

export function AddUrlForm({ websiteId, domain }: { websiteId: string; domain: string }) {
  const { state, onSubmit, pending } = useFormAction(addManualUrl.bind(null, websiteId));
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <FormMessage state={state} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Field
          id="url"
          label="Add a URL"
          hint={`A page on ${domain} that nothing links to, such as a landing page. It is checked on every run.`}
          errors={state.fieldErrors?.url}
          className="flex-1"
        >
          <Input
            {...describe("url", state)}
            type="url"
            inputMode="url"
            placeholder={`https://${domain}/landing/offer`}
            defaultValue={state.ok ? undefined : state.values?.url}
            key={state.ok ? "reset" : state.values?.url}
            className="font-mono text-[13px]"
            spellCheck={false}
            required
          />
        </Field>
        <SubmitButton pending={pending} pendingText="Adding…" className="sm:mt-[26px]">
          Add URL
        </SubmitButton>
      </div>
    </form>
  );
}
