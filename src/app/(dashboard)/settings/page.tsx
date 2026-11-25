import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LocalTime } from "@/components/layout/local-time";
import { ChangePasswordForm, SignOutEverywhere } from "@/components/settings/account-forms";
import { db } from "@/lib/db";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/server/auth/roles";
import { requireUser } from "@/server/auth/session";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  const current = await requireUser();
  const user = await db.user.findUniqueOrThrow({ where: { id: current.id }, select: { lastLoginAt: true, createdAt: true } });

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Your account</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-[160px_1fr]">
            <dt className="text-muted-foreground">Name</dt>
            <dd>{current.name}</dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd>{current.email}</dd>
            <dt className="text-muted-foreground">Role</dt>
            <dd>
              {ROLE_LABELS[current.role]} <span className="text-muted-foreground">({ROLE_DESCRIPTIONS[current.role].toLowerCase()})</span>
            </dd>
            <dt className="text-muted-foreground">Last sign-in</dt>
            <dd>
              <LocalTime value={user.lastLoginAt} />
            </dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>Changing your password signs out your other sessions.</CardDescription>
        </CardHeader>
        <ChangePasswordForm />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
          <CardDescription>Use this if you signed in on a shared computer or think someone else has access.</CardDescription>
        </CardHeader>
        <CardContent>
          <SignOutEverywhere />
        </CardContent>
      </Card>
    </div>
  );
}
