import Link from "next/link";
import { Globe, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/layout/empty-state";
import { LocalTime } from "@/components/layout/local-time";
import { PageHeader } from "@/components/layout/page-header";
import { Pager } from "@/components/layout/pager";
import { RunNowButton } from "@/components/runs/run-now";
import { formatDuration, RUN_STATUS } from "@/components/runs/run-format";
import { navItem } from "@/lib/navigation";
import { pageNumber, param } from "@/lib/search-params";
import { formatNumber } from "@/lib/utils";
import { hasRole } from "@/server/auth/roles";
import { requireUser } from "@/server/auth/session";
import { listRuns, RUN_PAGE_SIZE } from "@/server/runs/queries";
import { getActiveWebsite } from "@/server/websites/queries";

const item = navItem("/history");
export const metadata = { title: item.label };

export default async function HistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const website = await getActiveWebsite();
  if (!website) {
    return (
      <>
        <PageHeader title={item.label} description={item.description} />
        <Card><EmptyState icon={Globe} title="No website is set up yet" /></Card>
      </>
    );
  }
  const page = pageNumber(param(await searchParams, "page"));
  const { total, rows, queued, running } = await listRuns(website.id, page);

  return (
    <>
      <PageHeader title={item.label} description={item.description} actions={hasRole(user.role, "EDITOR") && <RunNowButton websiteId={website.id} />} />
      {(queued > 0 || running) && (
        <p role="status" className="mb-4 rounded-md bg-primary-soft px-4 py-2.5 text-sm">
          {running ? "A run is in progress. " : ""}
          {queued > 0 && <>A run is queued and starts when a worker picks it up (<code className="font-mono text-xs">npm run worker -- --loop</code> keeps one running).</>}
        </p>
      )}
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={History} title="No runs yet">
            Runs appear here once the worker has checked the site, whether on the schedule, from “Run now” or from the command line.
          </EmptyState>
        ) : (
          <Table className="[&_td]:whitespace-nowrap">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead className="text-right">URLs checked</TableHead>
                <TableHead className="text-right">Failing</TableHead>
                <TableHead className="text-right">Issues new / resolved</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/history/${r.number}`} className="font-medium hover:text-primary hover:underline">#{r.number}</Link>
                  </TableCell>
                  <TableCell>
                    <Badge tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label}</Badge>
                    {r.errorMessage && r.status !== "COMPLETED" && <span className="mt-0.5 block max-w-[24ch] truncate text-xs text-muted-foreground" title={r.errorMessage}>{r.errorMessage}</span>}
                  </TableCell>
                  <TableCell>
                    {r.scanType === "FULL" ? "Full" : "Incremental"}
                    <span className="block text-xs text-muted-foreground">{r.trigger === "SCHEDULED" ? "Scheduled" : "Manual"}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground"><LocalTime value={r.startedAt ?? r.createdAt} /></TableCell>
                  <TableCell className="text-right tabular-nums">{formatDuration(r.durationMs)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(r.urlsChecked)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.failedChecks ? <span className="text-destructive">{formatNumber(r.failedChecks)}</span> : "0"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={r.newIssues ? "text-destructive" : undefined}>+{formatNumber(r.newIssues)}</span>
                    <span className="text-muted-foreground"> / </span>
                    <span className={r.resolvedIssues ? "text-success" : undefined}>−{formatNumber(r.resolvedIssues)}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pager page={page} pageSize={RUN_PAGE_SIZE} total={total} href={(p) => (p > 1 ? `/history?page=${p}` : "/history")} />
      </Card>
    </>
  );
}
