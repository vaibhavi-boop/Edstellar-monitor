import Link from "next/link";
import { Globe, Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/layout/empty-state";
import { LocalTime } from "@/components/layout/local-time";
import { PageHeader } from "@/components/layout/page-header";
import { OverviewCharts } from "@/components/dashboard/charts";
import { HealthDial } from "@/components/dashboard/health-dial";
import { StatTile } from "@/components/dashboard/stat-tile";
import { HEALTH_WEIGHTS, ISSUE_PENALTIES } from "@/lib/health-score";
import { formatMs, formatNumber, formatPercent, frequencyLabel } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { getOverview } from "@/server/dashboard/overview";
import { getActiveWebsite, getWebsite } from "@/server/websites/queries";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const user = await requireUser();
  const active = await getActiveWebsite();

  if (!active) {
    return (
      <>
        <PageHeader title="Overview" />
        <Card>
          <EmptyState
            icon={Globe}
            title="No website is set up yet"
            action={
              user.role === "ADMIN" ? (
                <Button asChild>
                  <Link href="/websites/new">Add a website</Link>
                </Button>
              ) : undefined
            }
          >
            {user.role === "ADMIN"
              ? "Add edstellar.com to start monitoring, or run npm run db:seed to create it with the default settings."
              : "An administrator needs to add a website before anything can be monitored."}
          </EmptyState>
        </Card>
      </>
    );
  }

  const [data, website] = await Promise.all([getOverview(active.id), getWebsite(active.id)]);
  const { stats, health } = data;
  const config = website?.configuration;

  return (
    <>
      <PageHeader
        title={active.name}
        description={
          <>
            <a href={active.url} className="font-mono text-[13px] text-primary hover:underline" rel="noreferrer" target="_blank">
              {active.url.replace(/^https?:\/\//, "")}
            </a>
            {config && <span> is checked {frequencyLabel(config.crawlFrequencyMinutes).toLowerCase()}</span>}
          </>
        }
        actions={
          active.status === "PAUSED" ? <Badge tone="warning">Monitoring paused</Badge> : <Badge tone="success">Monitoring on</Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Health score</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-5 sm:flex-row lg:flex-col">
            <HealthDial health={health} />
            <dl className="w-full max-w-xs space-y-2.5 text-sm">
              <ScorePart color="var(--primary)" label="Availability" value={health?.availability} max={HEALTH_WEIGHTS.availability} />
              <ScorePart color="var(--success)" label="Open issues" value={health?.issues} max={HEALTH_WEIGHTS.issues} />
              <ScorePart color="var(--warning)" label="SSL certificate" value={health?.ssl ?? undefined} max={HEALTH_WEIGHTS.ssl} pending={health?.ssl === null} />
            </dl>
          </CardContent>
          <details className="border-t px-5 py-3 text-[13px] text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">How the score is calculated</summary>
            <ul className="mt-2 space-y-1.5 leading-relaxed">
              <li>Availability: {HEALTH_WEIGHTS.availability} × the share of checked URLs that responded successfully.</li>
              <li>
                Open issues: {HEALTH_WEIGHTS.issues} minus {ISSUE_PENALTIES.critical} per critical, {ISSUE_PENALTIES.high} per high,{" "}
                {ISSUE_PENALTIES.medium} per medium and {ISSUE_PENALTIES.low} per low issue, never below 0. Informational issues do not count.
              </li>
              <li>
                SSL: {HEALTH_WEIGHTS.ssl} for a valid certificate with more than 30 days left, {HEALTH_WEIGHTS.ssl / 2} with 30 days or
                fewer, 0 if invalid. Until SSL is checked, the other two parts are scaled to 100.
              </li>
              <li>No score is shown until at least one URL has been checked.</li>
            </ul>
          </details>
        </Card>

        <Card>
          <div className="overflow-hidden rounded-t-lg">
          <dl className="-mb-px -mr-px grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 [&>*]:border-b [&>*]:border-r">
            <StatTile label="Discovered URLs" value={formatNumber(stats.totalUrls)} hint={`${formatNumber(stats.checkedUrls)} checked`} />
            <StatTile label="Healthy URLs" value={formatNumber(stats.healthyUrls)} tone="success" />
            <StatTile label="Broken URLs" value={formatNumber(stats.brokenUrls)} tone="danger" />
            <StatTile label="Availability" value={formatPercent(stats.availabilityPct)} />
            <StatTile label="Avg. response" value={formatMs(stats.avgResponseMs)} hint="HTTP only" />
            <StatTile label="Open issues" value={formatNumber(stats.openIssues)} />
            <StatTile label="Critical" value={formatNumber(stats.criticalIssues)} tone="danger" />
            <StatTile label="High priority" value={formatNumber(stats.highIssues)} tone="warning" />
            <StatTile label="Resolved" value={formatNumber(stats.resolvedIssues)} />
            <StatTile label="API failures" value={formatNumber(stats.apiFailures24h)} hint="Last 24 hours" tone="danger" />
          </dl>
          </div>
          <div className="flex items-center gap-3 px-5 py-3 text-[13px] text-muted-foreground">
            <Radar className="size-4 shrink-0" />
            {data.lastRun ? (
              <span>
                Last run #{data.lastRun.number}: {data.lastRun.status.toLowerCase()},{" "}
                <LocalTime value={data.lastRun.finishedAt ?? data.lastRun.startedAt} mode="relative" />
              </span>
            ) : (
              <span>No monitoring run has completed yet. Crawling and checks are added in build phase 2.</span>
            )}
          </div>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-[15px] font-semibold">Trends</h2>
      <OverviewCharts charts={data.charts} />
    </>
  );
}

function ScorePart({ color, label, value, max, pending }: { color: string; label: string; value?: number; max: number; pending?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="size-2.5 shrink-0 rounded-sm" style={{ background: color }} aria-hidden="true" />
      <dt className="flex-1 whitespace-nowrap text-muted-foreground">{label}</dt>
      <dd className="whitespace-nowrap font-medium">
        {pending ? <span className="text-muted-foreground">Not checked</span> : value == null ? "—" : `${value} / ${max}`}
      </dd>
    </div>
  );
}
