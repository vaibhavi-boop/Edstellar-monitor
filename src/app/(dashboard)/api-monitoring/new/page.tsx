import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { EndpointForm } from "@/components/api/endpoint-form";
import { requireRole } from "@/server/auth/session";
import { getActiveWebsite } from "@/server/websites/queries";

export const metadata = { title: "Add API endpoint" };

export default async function NewEndpointPage() {
  await requireRole("ADMIN");
  const website = await getActiveWebsite();
  return (
    <>
      <Link href="/api-monitoring" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> API monitoring
      </Link>
      <PageHeader title="Add API endpoint" description={website ? `Checked on every monitoring run of ${website.name}.` : undefined} />
      <Card className="max-w-3xl">
        {website ? (
          <>
            <CardHeader>
              <CardTitle>Endpoint</CardTitle>
              <CardDescription>Credentials are encrypted with AES-256-GCM before they are stored and are never shown again.</CardDescription>
            </CardHeader>
            <EndpointForm websiteId={website.id} canEdit />
          </>
        ) : (
          <EmptyState title="Add a website first" />
        )}
      </Card>
    </>
  );
}
