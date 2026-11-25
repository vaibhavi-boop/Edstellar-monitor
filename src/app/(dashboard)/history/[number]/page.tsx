import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { JobStage, JobStatus, NotificationEvent } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatTile } from "@/components/dashboard/stat-tile";
import { LocalTime } from "@/components/layout/local-time";
import { PageHeader } from "@/components/layout/page-header";
import { SeverityBadge } from "@/components/issues/badges";
import { formatMs, formatNumber, issueRef } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import type { RunSummary } from "@/server/engine/run";
import { EVENT_LABELS } from "@/server/notify/events";
import { getRun } from "@/server/runs/queries";
import { formatDuration, RUN_STATUS } from "@/components/runs/run-format";

export const metadata = { title: "Run" };

const STAGE_LABELS: Record<JobStage, string> = {
  AVAILABILITY: "Availability re-check",
  SITEMAP: "robots.txt and sitemaps",
  DISCOVERY: "Discovery",
  CRAWL: "Crawl and availability",
  LINKS: "Link graph",
  SEO: "SEO audit",
  API: "API endpoints",
  REDIRECTS: "Redirect inventory",
  SSL_DNS: "SSL and DNS",
  PERFORMANCE: "Performance",
  ISSUES: "Issue reconciliation",
  REPORT: "Report",
  NOTIFY: "Notifications",
};
const JOB_TONE: Record<JobStatus, "success" | "danger" | "primary" | "neutral"> = { COMPLETED: "success", FAILED: "danger", RUNNING: "primary", PENDING: "neutral", SKIPPED: "neutral" };

export default async function RunPage({ params }: { params: Promise<{ number: string }> }) {
  await requireUser();
  const { number } = await params;
  if (!/^\d{1,9}$/.test(number)) notFound();
  const data = await getRun(Number(number));
  if (!data) notFound();
  const { run, triggeredBy, occurrences, notifications, recent } = data;
  const s = (run.summary ?? {}) as Partial<RunSummary>;
  const count = (kind: string) => occurrences.find((o) => o.kind === kind)?._count._all ?? 0;

  return (
    <>
      <Link href="/history" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Monitoring history
      </Link>
      <PageHeader
        title={<span className="flex items-center gap-3">Run #{run.number} <Badge tone={RUN_STATUS[run.status].tone}>{RUN_STATUS[run.status].label}</Badge></span>}
        description={
          <>
            {run.scanType === "FULL" ? "Full scan" : "Incremental scan"} of {run.website.domain}, {run.trigger === "SCHEDULED" ? "scheduled" : `started manually${triggeredBy ? ` by ${triggeredBy}` : ""}`}.{" "}
            {run.startedAt ? <>Started <LocalTime value={run.startedAt} />.</> : <>Queued <LocalTime value={run.createdAt} mode="relative" />.</>}
          </>
        }
      />
      {run.errorMessage && <p role="alert" className="mb-4 rounded-md bg-destructive-soft px-4 py-2.5 text-sm text-destructive">{run.errorMessage}</p>}

      <Card className="mb-4">
        <div className="overflow-hidden rounded-lg">
          <dl className="-mb-px -mr-px grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 [&>*]:border-b [&>*]:border-r">
            <StatTile label="Duration" value={formatDuration(run.durationMs)} />
            <StatTile label="URLs checked" value={formatNumber(run.urlsChecked)} hint={s.crawl?.truncated ? `Stopped at the ${formatNumber(s.crawl.maxUrls)}-URL limit` : undefined} />
            <StatTile label="Failing URLs" value={formatNumber(run.failedChecks)} tone="danger" />
            <StatTile label="New issues" value={formatNumber(count("DETECTED"))} />
            <StatTile label="Came back" value={formatNumber(count("RECURRED"))} tone="warning" />
            <StatTile label="Resolved" value={formatNumber(count("AUTO_RESOLVED"))} tone="success" />
          </dl>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="self-start">
          <CardHeader><CardTitle>Stages</CardTitle></CardHeader>
          <Table className="[&_td]:whitespace-nowrap">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Stage</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.jobs.map((j) => (
                <TableRow key={j.id}>
                  <TableCell>{STAGE_LABELS[j.stage]}{j.errorMessage && <p className="max-w-[36ch] truncate text-xs text-destructive" title={j.errorMessage}>{j.errorMessage}</p>}</TableCell>
                  <TableCell><Badge tone={JOB_TONE[j.status]}>{j.status.toLowerCase()}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(j.processed)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{j.startedAt && j.finishedAt ? formatMs(j.finishedAt.getTime() - j.startedAt.getTime()) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {s.checks && (
            <dl className="grid gap-x-6 gap-y-2 border-t p-5 text-sm sm:grid-cols-3">
              <div><dt className="text-[13px] text-muted-foreground">SSL</dt><dd>{s.checks.ssl ? (s.checks.ssl.valid ? `Valid, ${s.checks.ssl.daysRemaining} days left` : "Not valid") : "—"}</dd></div>
              <div><dt className="text-[13px] text-muted-foreground">Median TTFB</dt><dd>{formatMs(s.checks.performance.medianTtfbMs)}</dd></div>
              <div><dt className="text-[13px] text-muted-foreground">APIs</dt><dd>{s.checks.api.checked ? `${s.checks.api.checked - s.checks.api.failing} of ${s.checks.api.checked} passing` : "None configured"}</dd></div>
            </dl>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Issue changes</CardTitle>
              <CardDescription>The most severe of the issues this run opened, reopened or resolved.</CardDescription>
            </CardHeader>
            {recent.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">No issue changed in this run.</p>
            ) : (
              <ul>
                {recent.map((o) => (
                  <li key={o.id} className="flex items-center gap-2 border-b px-5 py-2 text-sm last:border-0">
                    <SeverityBadge value={o.issue.severity} />
                    <Link href={`/issues/${o.issue.number}`} className="font-mono text-[13px] text-muted-foreground hover:text-primary">{issueRef(o.issue.number)}</Link>
                    <span className="min-w-0 flex-1 truncate" title={o.issue.affectedUrl ?? ""}>{o.issue.title}</span>
                    <span className="text-xs text-muted-foreground">{o.kind === "DETECTED" ? "new" : o.kind === "RECURRED" ? "back" : "resolved"}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader><CardTitle>Notifications</CardTitle></CardHeader>
            {notifications.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">None sent. Notifications go out only when issues change and someone subscribes to that event.</p>
            ) : (
              <ul>
                {notifications.map((n) => (
                  <li key={n.id} className="flex flex-wrap items-center gap-2 border-b px-5 py-2 text-sm last:border-0">
                    <Badge tone={n.status === "SENT" ? "success" : n.status === "FAILED" ? "danger" : "neutral"}>{n.status.toLowerCase()}</Badge>
                    <span>{n.channel === "EMAIL" ? "Email" : "Slack"}</span>
                    <span className="text-muted-foreground">{EVENT_LABELS[n.event as NotificationEvent]} ({(n.payload as { count?: number }).count ?? 1})</span>
                    {n.error && <span className="w-full text-xs text-destructive">{n.error}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {s.log && s.log.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Log</CardTitle>
            <CardDescription>Times are UTC, as printed by the worker.</CardDescription>
          </CardHeader>
          <pre className="max-h-[420px] overflow-auto p-5 font-mono text-xs leading-relaxed">{s.log.join("\n")}</pre>
        </Card>
      )}
    </>
  );
}
