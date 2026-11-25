import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { WebsiteCreateForm } from "@/components/websites/website-create-form";
import { requireRole } from "@/server/auth/session";

export const metadata = { title: "Add website" };

export default async function NewWebsitePage() {
  await requireRole("ADMIN");
  return (
    <div className="max-w-2xl">
      <PageHeader title="Add a website" />
      <Card>
        <CardHeader>
          <CardTitle>Website details</CardTitle>
          <CardDescription>
            The domain is resolved before saving. Domains that point to private or internal networks are refused. Monitoring settings
            start with the four-hour defaults and can be changed on the next screen.
          </CardDescription>
        </CardHeader>
        <WebsiteCreateForm />
      </Card>
    </div>
  );
}
