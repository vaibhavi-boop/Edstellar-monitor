"use client";
import { updateWebsiteGeneral } from "@/server/websites/actions";
import { Input } from "@/components/ui/input";
import { CardContent, CardFooter } from "@/components/ui/card";
import { describe, Field, FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";

export function WebsiteGeneralForm({ website, canEdit }: { website: { id: string; name: string; url: string }; canEdit: boolean }) {
  const { state, onSubmit, pending } = useFormAction(updateWebsiteGeneral.bind(null, website.id));
  return (
    <form onSubmit={onSubmit} noValidate>
      <fieldset disabled={!canEdit} className="contents">
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <FormMessage state={state} />
          </div>
          <Field id="name" label="Name" errors={state.fieldErrors?.name}>
            <Input {...describe("name", state)} defaultValue={website.name} required />
          </Field>
          <Field id="url" label="Website URL" hint="Changing the domain keeps existing history on this website" errors={state.fieldErrors?.url}>
            <Input {...describe("url", state)} defaultValue={website.url} type="url" required />
          </Field>
        </CardContent>
        {canEdit && (
          <CardFooter>
            <SubmitButton pending={pending} pendingText="Saving…">Save details</SubmitButton>
          </CardFooter>
        )}
      </fieldset>
    </form>
  );
}
