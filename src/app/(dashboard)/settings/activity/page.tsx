import { ScrollText } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/layout/empty-state";
import { LocalTime } from "@/components/layout/local-time";
import { requireRole } from "@/server/auth/session";
import { recentAuditEntries } from "@/server/users/queries";

export const metadata = { title: "Activity log" };

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.logout": "Signed out",
  "auth.password_changed": "Changed their password",
  "auth.signed_out_everywhere": "Signed out everywhere",
  "user.created": "Added a user",
  "user.role_changed": "Changed a user's role",
  "user.deactivated": "Deactivated a user",
  "user.reactivated": "Reactivated a user",
  "user.password_reset": "Reset a user's password",
  "user.seeded_admin": "Created the first administrator",
  "website.created": "Added a website",
  "website.updated": "Edited website details",
  "website.configuration_updated": "Changed monitoring settings",
  "website.paused": "Paused monitoring",
  "website.resumed": "Resumed monitoring",
  "website.deleted": "Deleted a website",
  "url.added_manually": "Added a URL manually",
  "issue.status_changed": "Changed an issue's status",
  "api.created": "Added an API endpoint",
  "api.updated": "Edited an API endpoint",
  "api.deleted": "Deleted an API endpoint",
  "run.requested": "Queued a monitoring run",
  "notification.added": "Added a notification recipient",
  "notification.removed": "Removed a notification recipient",
};

function detail(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") return "";
  const m = metadata as Record<string, unknown>;
  if (Array.isArray(m.changed)) return m.changed.length ? `Fields: ${m.changed.join(", ")}` : "No fields changed";
  if (typeof m.email === "string") return `${m.email}${typeof m.role === "string" ? `, ${m.role.toLowerCase()}` : ""}`;
  if (typeof m.from === "string" && typeof m.to === "string") return `${m.from.toLowerCase()} to ${m.to.toLowerCase()}`;
  if (typeof m.domain === "string") return m.domain;
  if (typeof m.url === "string") return m.url;
  if (typeof m.name === "string") return m.name;
  return "";
}

export default async function ActivityPage() {
  await requireRole("ADMIN");
  const entries = await recentAuditEntries(100);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity log</CardTitle>
        <CardDescription>The latest 100 changes and sign-ins. IP addresses are stored only as hashes.</CardDescription>
      </CardHeader>
      {entries.length === 0 ? (
        <EmptyState icon={ScrollText} title="No activity recorded yet" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>What</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  <LocalTime value={e.createdAt} />
                </TableCell>
                <TableCell>{e.actor?.name ?? "System"}</TableCell>
                <TableCell>{ACTION_LABELS[e.action] ?? e.action}</TableCell>
                <TableCell className="text-muted-foreground">{detail(e.metadata)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
