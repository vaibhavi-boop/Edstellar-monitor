import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AddUserDialog, UsersTable } from "@/components/settings/users-table";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/server/auth/roles";
import { requireRole } from "@/server/auth/session";
import { listUsers } from "@/server/users/queries";

export const metadata = { title: "Team access" };

export default async function UsersPage() {
  const admin = await requireRole("ADMIN");
  const users = await listUsers();
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Team access</CardTitle>
          <CardDescription className="mt-1">
            {(["ADMIN", "EDITOR", "VIEWER"] as const).map((r, i) => (
              <span key={r}>
                {i > 0 && "; "}
                <span className="text-foreground">{ROLE_LABELS[r]}</span>: {ROLE_DESCRIPTIONS[r].toLowerCase()}
              </span>
            ))}
            .
          </CardDescription>
        </div>
        <AddUserDialog />
      </CardHeader>
      <UsersTable users={users} currentUserId={admin.id} />
    </Card>
  );
}
