"use client";
import { useState, useTransition } from "react";
import { KeyRound, UserPlus } from "lucide-react";
import type { ActionState } from "@/lib/action-state";
import { createUser, resetUserPassword, setUserActive, updateUserRole } from "@/server/users/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { describe, Field, FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LocalTime } from "@/components/layout/local-time";

type Role = "ADMIN" | "EDITOR" | "VIEWER";
type UserRow = { id: string; name: string; email: string; role: Role; isActive: boolean; lastLoginAt: Date | null };

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: "ADMIN", label: "Administrator" },
  { value: "EDITOR", label: "Editor" },
  { value: "VIEWER", label: "Viewer" },
];

export function AddUserDialog() {
  const [open, setOpen] = useState(false);
  const { state, onSubmit, pending } = useFormAction(createUser);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus /> Add user
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Add a team member</DialogTitle>
        <DialogDescription>Set a temporary password and share it securely. They can change it from Account settings.</DialogDescription>
        {state.ok ? (
          <div className="mt-5 flex flex-col gap-4">
            <FormMessage state={state} />
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4" noValidate>
            <FormMessage state={state} />
            <Field id="new-name" label="Name" errors={state.fieldErrors?.name}>
              <Input {...describe("new-name", state, "name")} />
            </Field>
            <Field id="new-email" label="Email" errors={state.fieldErrors?.email}>
              <Input {...describe("new-email", state, "email")} type="email" autoComplete="off" />
            </Field>
            <Field id="new-role" label="Role" errors={state.fieldErrors?.role}>
              <NativeSelect {...describe("new-role", state, "role")} defaultValue="VIEWER">
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="new-password" label="Temporary password" hint="At least 12 characters, with a letter and a number" errors={state.fieldErrors?.password}>
              <Input {...describe("new-password", state, "password")} type="text" autoComplete="new-password" spellCheck={false} className="font-mono" />
            </Field>
            <SubmitButton pending={pending} pendingText="Adding…">
              Add user
            </SubmitButton>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user }: { user: UserRow }) {
  const { state, onSubmit, pending } = useFormAction(resetUserPassword.bind(null, user.id));
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <KeyRound /> Reset password
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Reset password for {user.name}</DialogTitle>
        <DialogDescription>They will be signed out everywhere and must use the new password.</DialogDescription>
        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4" noValidate>
          <FormMessage state={state} />
          {!state.ok && (
            <>
              <Field id={`reset-${user.id}`} label="New temporary password" errors={state.fieldErrors?.password}>
                <Input {...describe(`reset-${user.id}`, state, "password")} type="text" autoComplete="new-password" spellCheck={false} className="font-mono" />
              </Field>
              <SubmitButton pending={pending} pendingText="Resetting…">
                Reset password
              </SubmitButton>
            </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UsersTable({ users, currentUserId }: { users: UserRow[]; currentUserId: string }) {
  const [message, setMessage] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<ActionState>) => startTransition(async () => setMessage(await fn()));

  return (
    <>
      {message.message && (
        <div className="px-5 pt-4">
          <FormMessage state={message} />
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>User</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last sign-in</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => {
            const self = u.id === currentUserId;
            return (
              <TableRow key={u.id} className={u.isActive ? undefined : "opacity-60"}>
                <TableCell>
                  <p className="font-medium">
                    {u.name} {self && <span className="font-normal text-muted-foreground">(you)</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                </TableCell>
                <TableCell>
                  <NativeSelect
                    aria-label={`Role for ${u.name}`}
                    className="h-8 w-40"
                    defaultValue={u.role}
                    disabled={self || pending}
                    onChange={(e) => run(() => updateUserRole(u.id, e.target.value))}
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </NativeSelect>
                </TableCell>
                <TableCell>{u.isActive ? <Badge tone="success">Active</Badge> : <Badge>Deactivated</Badge>}</TableCell>
                <TableCell className="text-muted-foreground">
                  {u.lastLoginAt ? <LocalTime value={u.lastLoginAt} mode="relative" /> : "Never"}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <ResetPasswordDialog user={u} />
                    {!self && (
                      <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setUserActive(u.id, !u.isActive))}>
                        {u.isActive ? "Deactivate" : "Reactivate"}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
}
