"use client";
import Link from "next/link";
import { createWebsite } from "@/server/websites/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CardContent, CardFooter } from "@/components/ui/card";
import { describe, Field, FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";

export function WebsiteCreateForm() {
  const { state, onSubmit, pending } = useFormAction(createWebsite);
  return (
    <form onSubmit={onSubmit} noValidate>
      <CardContent className="flex flex-col gap-4">
        <FormMessage state={state} />
        <Field id="name" label="Name" hint="Shown in the website switcher and reports" errors={state.fieldErrors?.name}>
          <Input {...describe("name", state)} placeholder="Edstellar" required />
        </Field>
        <Field
          id="url"
          label="Website URL"
          hint="The home page, e.g. https://www.edstellar.com. Only this domain and its www version are crawled."
          errors={state.fieldErrors?.url}
        >
          <Input {...describe("url", state)} type="url" placeholder="https://www.example.com" required />
        </Field>
      </CardContent>
      <CardFooter>
        <SubmitButton pending={pending} pendingText="Checking domain…">Add website</SubmitButton>
        <Button variant="ghost" asChild>
          <Link href="/websites">Cancel</Link>
        </Button>
      </CardFooter>
    </form>
  );
}
