import { notFound } from "next/navigation";
import { CircleCheck, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LocalTime } from "@/components/layout/local-time";
import { PageHeader } from "@/components/layout/page-header";
import { WebsiteConfigForm } from "@/components/websites/website-config-form";
import { WebsiteDangerZone } from "@/components/websites/website-danger-zone";
import { WebsiteGeneralForm } from "@/components/websites/website-general-form";
import { NotificationSettings } from "@/components/websites/notification-settings";
import { db } from "@/lib/db";
import { smtpConfigured } from "@/server/notify/send";
import { requireUser } from "@/server/auth/session";
import { getWebsite } from "@/server/websites/queries";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const website = await getWebsite((await params).id);
  return { title: website ? `${website.name} settings` : "Website" };
}

export default async function WebsiteSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const [{ id }, { created }] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const website = await getWebsite(id);
  if (!website || !website.configuration) notFound();
  const canEdit = user.role === "ADMIN";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        className="pb-0"
        title={website.name}
        description={
          <>
            <span className="font-mono text-[13px]">{website.domain}</span>, added <LocalTime value={website.createdAt} mode="date" />
          </>
        }
        actions={website.status === "ACTIVE" ? <Badge tone="success">Active</Badge> : <Badge tone="warning">Paused</Badge>}
      />

      {created && (
        <div role="status" className="flex items-start gap-2 rounded-md bg-success-soft px-4 py-3 text-sm text-success">
          <CircleCheck className="mt-0.5 size-4 shrink-0" />
          {website.domain} was added with the default settings: checked every 4 hours, up to 10,000 URLs, 4 concurrent requests.
        </div>
      )}
      {!canEdit && (
        <div className="flex items-center gap-2 rounded-md bg-surface-muted px-4 py-3 text-sm text-muted-foreground">
          <Lock className="size-4" /> Only administrators can change website settings.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <WebsiteGeneralForm website={website} canEdit={canEdit} />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Monitoring settings</CardTitle>
          <CardDescription>
            Last changed <LocalTime value={website.configuration.updatedAt} />
          </CardDescription>
        </CardHeader>
        <WebsiteConfigForm websiteId={website.id} domain={website.domain} config={website.configuration} canEdit={canEdit} />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>Email or Slack, per event. Sent after each monitoring run as one digest, and only for changes, never for issues that are simply still open.</CardDescription>
        </CardHeader>
        <NotificationSettings
          websiteId={website.id}
          canEdit={canEdit}
          smtpReady={smtpConfigured()}
          prefs={(await db.notificationPreference.findMany({ where: { websiteId: website.id }, orderBy: { createdAt: "asc" }, select: { id: true, channel: true, target: true, events: true, isEnabled: true } }))}
        />
      </Card>

      {canEdit && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle>Pause or delete</CardTitle>
          </CardHeader>
          <WebsiteDangerZone website={{ id: website.id, name: website.name, domain: website.domain, status: website.status }} />
        </Card>
      )}
    </div>
  );
}
