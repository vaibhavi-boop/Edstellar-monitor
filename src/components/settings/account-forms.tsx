"use client";
import { LogOut } from "lucide-react";
import { changePassword, signOutEverywhere } from "@/server/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CardContent, CardFooter } from "@/components/ui/card";
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
import { buttonVariants } from "@/components/ui/button";
import { describe, Field, FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";

export function ChangePasswordForm() {
  const { state, onSubmit, pending } = useFormAction(changePassword);
  return (
    <form onSubmit={onSubmit} noValidate key={state.ok ? "done" : "editing"}>
      <CardContent className="flex max-w-md flex-col gap-4">
        <FormMessage state={state} />
        <Field id="currentPassword" label="Current password" errors={state.fieldErrors?.currentPassword}>
          <Input {...describe("currentPassword", state)} type="password" autoComplete="current-password" />
        </Field>
        <Field id="newPassword" label="New password" hint="At least 12 characters, with a letter and a number" errors={state.fieldErrors?.newPassword}>
          <Input {...describe("newPassword", state)} type="password" autoComplete="new-password" />
        </Field>
        <Field id="confirmPassword" label="Confirm new password" errors={state.fieldErrors?.confirmPassword}>
          <Input {...describe("confirmPassword", state)} type="password" autoComplete="new-password" />
        </Field>
      </CardContent>
      <CardFooter>
        <SubmitButton pending={pending} pendingText="Changing…">
          Change password
        </SubmitButton>
      </CardFooter>
    </form>
  );
}

export function SignOutEverywhere() {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline">
          <LogOut /> Sign out everywhere
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>Sign out on every device?</AlertDialogTitle>
        <AlertDialogDescription>All your sessions end, including this one. You will need to sign in again.</AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction className={buttonVariants({ variant: "destructive" })} onClick={() => void signOutEverywhere()}>
            Sign out everywhere
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
