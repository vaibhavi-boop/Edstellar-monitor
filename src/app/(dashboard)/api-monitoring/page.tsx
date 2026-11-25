import Link from "next/link";
import { Globe, Lock, Plus, PlugZap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatTile } from "@/components/dashboard/stat-tile";
import { EmptyState } from "@/components/layout/empty-state";
import { LocalTime } from "@/components/layout/local-time";
import { PageHeader } from "@/components/layout/page-header";
import { navItem } from "@/lib/navigation";
import { cn, formatMs, formatNumber, formatPercent } from "@/lib/utils";
import { listEndpoints } from "@/server/api-endpoints/queries";
import { requireUser } from "@/server/auth/session";
import { getActiveWebsite } from "@/server/websites/queries";

const item = navItem("/api-monitoring");
export const metadata = { title: item.label };

export default async function ApiMonitoringPage() {
  const user = await requireUser();
  const website = await getActiveWebsite();
  const isAdmin = user.role === "ADMIN";
  if (!website) {
    return (
      <>
        <PageHeader title={item.label} description={item.description} />
        <Card><EmptyState icon={Globe} title="No website is set up yet" /></Card>
      </>
    );
  }
  const endpoints = await listEndpoints(website.id);
  const active = endpoints.filter((e) => e.isActive);
  const failing = active.filter((e) => e.last && !e.last.ok).length;
  const timed = active.filter((e) => e.last?.responseTimeMs != null);
  const avg = timed.length ? timed.reduce((n, e) => n + e.last!.responseTimeMs!, 0) / timed.length : null;

  const addButton = isAdmin && (
    <Button asChild>
      <Link href="/api-monitoring/new"><Plus /> Add endpoint</Link>
    </Button>
  );

  return (
    <>
      <PageHeader title={item.label} description={item.description} actions={endpoints.length > 0 && addButton} />
      {endpoints.length === 0 ? (
        <Card>
          <EmptyState icon={PlugZap} title="No API endpoints yet" action={addButton}>
            Only endpoints you add are checked; the crawler never calls APIs on its own. Add one with its expected status and the JSON fields a
            healthy response must contain.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <div className="overflow-hidden rounded-lg">
              <dl className="-mb-px -mr-px grid grid-cols-2 sm:grid-cols-4 [&>*]:border-b [&>*]:border-r">
                <StatTile label="Active endpoints" value={formatNumber(active.length)} hint={endpoints.length > active.length ? `${endpoints.length - active.length} inactive` : undefined} />
                <StatTile label="Failing now" value={formatNumber(failing)} tone="danger" />
                <StatTile label="Healthy now" value={formatNumber(active.filter((e) => e.last?.ok).length)} tone="success" />
                <StatTile label="Avg. response" value={formatMs(avg)} hint="Latest check of each" />
              </dl>
            </div>
          </Card>
          <Card>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Latest</TableHead>
                  <TableHead className="text-right">Response</TableHead>
                  <TableHead className="text-right">Success 24 h</TableHead>
                  <TableHead className="text-right">Success 7 d</TableHead>
                  <TableHead>Checked</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {endpoints.map((e) => (
                  <TableRow key={e.id} className={cn(!e.isActive && "opacity-60")}>
                    <TableCell className="max-w-[min(52ch,50vw)]">
                      <Link href={`/api-monitoring/${e.id}`} className="font-medium hover:text-primary hover:underline">{e.name}</Link>
                      {!e.isActive && <Badge className="ml-2">Inactive</Badge>}
                      {e.authType !== "NONE" && <Lock className="ml-1.5 inline size-3.5 text-muted-foreground" aria-label="Uses stored credentials" />}
                      <p className="truncate font-mono text-xs text-muted-foreground" title={e.url}>
                        <span className="font-semibold">{e.method}</span> {e.url}
                      </p>
                    </TableCell>
                    <TableCell className="max-w-[28ch]">
                      {!e.last ? <Badge>Not checked</Badge> : e.last.ok ? <Badge tone="success">Passing · {e.last.statusCode}</Badge> : <Badge tone="danger">Failing{e.last.statusCode ? ` · ${e.last.statusCode}` : ""}</Badge>}
                      {e.last && !e.last.ok && e.last.errorMessage && <p className="truncate text-xs text-destructive" title={e.last.errorMessage}>{e.last.errorMessage}</p>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatMs(e.last?.responseTimeMs)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPercent(e.day?.pct)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPercent(e.week?.pct)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{e.lastCheckedAt ? <LocalTime value={e.lastCheckedAt} mode="relative" /> : "Never"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </>
  );
}
