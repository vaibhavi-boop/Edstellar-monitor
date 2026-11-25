import Link from "next/link";
import { Globe, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/layout/empty-state";
import { LocalTime } from "@/components/layout/local-time";
import { PageHeader } from "@/components/layout/page-header";
import { formatNumber, frequencyLabel } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { listWebsites } from "@/server/websites/queries";

export const metadata = { title: "Websites" };

export default async function WebsitesPage() {
  const user = await requireUser();
  const websites = await listWebsites();
  const isAdmin = user.role === "ADMIN";

  return (
    <>
      <PageHeader
        title="Websites"
        description="Each website is crawled within its own domain and its www version only."
        actions={
          isAdmin && (
            <Button asChild>
              <Link href="/websites/new">
                <Plus /> Add website
              </Link>
            </Button>
          )
        }
      />
      <Card>
        {websites.length === 0 ? (
          <EmptyState icon={Globe} title="No websites yet" action={isAdmin && <Button asChild><Link href="/websites/new">Add website</Link></Button>}>
            Add edstellar.com to start monitoring.
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Website</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Frequency</TableHead>
                <TableHead className="text-right">URLs</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead>Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {websites.map((w) => {
                const lastRun = w.monitoringRuns[0];
                return (
                  <TableRow key={w.id}>
                    <TableCell>
                      <Link href={`/websites/${w.id}`} className="font-medium hover:text-primary hover:underline">
                        {w.name}
                      </Link>
                      <p className="font-mono text-xs text-muted-foreground">{w.domain}</p>
                    </TableCell>
                    <TableCell>{w.status === "ACTIVE" ? <Badge tone="success">Active</Badge> : <Badge tone="warning">Paused</Badge>}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {w.configuration ? frequencyLabel(w.configuration.crawlFrequencyMinutes) : "—"}
                    </TableCell>
                    <TableCell className="text-right">{formatNumber(w._count.discoveredUrls)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {lastRun ? <LocalTime value={lastRun.finishedAt ?? lastRun.startedAt} mode="relative" /> : "Not run yet"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <LocalTime value={w.createdAt} mode="date" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
