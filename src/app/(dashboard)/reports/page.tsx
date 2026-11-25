import Link from "next/link";
import { Download, Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatTile } from "@/components/dashboard/stat-tile";
import { EmptyState } from "@/components/layout/empty-state";
import { LocalTime } from "@/components/layout/local-time";
import { PageHeader } from "@/components/layout/page-header";
import { SeverityBadge } from "@/components/issues/badges";
import { PrintButton } from "@/components/reports/print-button";
import { ISSUE_TYPES } from "@/lib/issue-catalog";
import { navItem } from "@/lib/navigation";
import { choice, param } from "@/lib/search-params";
import { PERFORMANCE } from "@/lib/thresholds";
import { cn, formatMs, formatNumber, formatPercent, issueRef } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { openCountsByType } from "@/server/issues/queries";
import { apiReport, brokenLinkReport, performanceReport, PERIODS, summaryReport, type Period } from "@/server/reports/queries";
import { latestSeoRun, SEO_PROBLEMS, seoCounts, type SeoProblem } from "@/server/seo/queries";
import { getActiveWebsite } from "@/server/websites/queries";

const item = navItem("/reports");
export const metadata = { title: item.label };

const REPORTS = { summary: "Health summary", seo: "SEO", "broken-links": "Broken links", api: "APIs", performance: "Performance" } as const;
type Report = keyof typeof REPORTS;
const TYPE_TITLES = new Map(ISSUE_TYPES.map((t) => [t.key, t]));
const path = (u: string | null) => (u ? u.replace(/^https?:\/\/[^/]+/, "") || "/" : "—");

function Export({ kind, period, label = "Download CSV" }: { kind: string; period?: Period; label?: string }) {
  return (
    <Button variant="outline" size="sm" asChild className="print:hidden">
      <a href={`/reports/export/${kind}${period ? `?period=${period}` : ""}`} download>
        <Download /> {label}
      </a>
    </Button>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const website = await getActiveWebsite();
  if (!website) {
    return (
      <>
        <PageHeader title={item.label} description={item.description} />
        <Card><EmptyState icon={Globe} title="No website is set up yet" /></Card>
      </>
    );
  }
  const params = await searchParams;
  const report = choice<Report>(param(params, "report"), REPORTS, "summary");
  const period = choice<Period>(param(params, "period"), PERIODS, "week");
  const hasPeriod = report === "summary" || report === "api" || report === "performance";
  const href = (r: Report, p: Period = period) => `/reports?report=${r}${r === "summary" || r === "api" || r === "performance" ? `&period=${p}` : ""}`;

  return (
    <>
      <PageHeader
        title={`${PERIODS[period].label && hasPeriod ? `${PERIODS[period].label} ` : ""}${REPORTS[report]} report`}
        description={
          <>
            {website.name} · <span className="font-mono text-[13px]">{website.domain}</span> · generated <LocalTime value={new Date()} />
          </>
        }
        actions={<PrintButton />}
      />
      <nav className="mb-4 flex flex-wrap items-center gap-2 print:hidden" aria-label="Reports">
        {(Object.keys(REPORTS) as Report[]).map((r) => (
          <Link key={r} href={href(r)} aria-current={report === r ? "page" : undefined} className={cn("rounded-md border px-3 py-1.5 text-sm", report === r ? "border-primary bg-primary text-primary-foreground" : "bg-surface hover:bg-surface-muted")}>
            {REPORTS[r]}
          </Link>
        ))}
        {hasPeriod && (
          <span className="ml-auto flex gap-1 rounded-md border bg-surface p-0.5">
            {(Object.keys(PERIODS) as Period[]).map((p) => (
              <Link key={p} href={href(report, p)} aria-current={period === p ? "true" : undefined} className={cn("rounded px-2.5 py-1 text-[13px]", period === p ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:text-foreground")}>
                {PERIODS[p].label} <span className="text-xs opacity-70">({PERIODS[p].days === 1 ? "24 h" : `${PERIODS[p].days} d`})</span>
              </Link>
            ))}
          </span>
        )}
      </nav>
      {report === "summary" && <Summary websiteId={website.id} period={period} />}
      {report === "seo" && <Seo websiteId={website.id} />}
      {report === "broken-links" && <BrokenLinks websiteId={website.id} />}
      {report === "api" && <Api websiteId={website.id} period={period} />}
      {report === "performance" && <Performance websiteId={website.id} period={period} />}
    </>
  );
}

async function Summary({ websiteId, period }: { websiteId: string; period: Period }) {
  const r = await summaryReport(websiteId, period);
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="overflow-hidden rounded-lg">
          <dl className="-mb-px -mr-px grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 [&>*]:border-b [&>*]:border-r">
            <StatTile label="Monitoring runs" value={formatNumber(r.runs.total)} hint={`${r.runs.completed} completed · ${r.runs.partial} partial · ${r.runs.failed} failed`} />
            <StatTile label="Availability" value={formatPercent(r.availability.pct, 2)} hint={`${formatNumber(r.availability.checks)} URL checks`} tone={r.availability.pct != null && r.availability.pct < 99 ? "warning" : "success"} />
            <StatTile label="Issues opened" value={formatNumber(r.issues.opened)} />
            <StatTile label="Issues resolved" value={formatNumber(r.issues.resolved)} tone="success" />
            <StatTile label="Median TTFB" value={formatMs(r.performance.median_ttfb)} hint={`${formatNumber(r.performance.samples)} measurements`} />
            <StatTile label="SSL" value={r.ssl ? (r.ssl.valid ? `${r.ssl.daysRemaining} days` : "Invalid") : "—"} hint={r.ssl?.issuer ? `Issued by ${r.ssl.issuer}` : undefined} tone={r.ssl && !r.ssl.valid ? "danger" : "default"} />
          </dl>
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Open issues now</CardTitle>
              <CardDescription>
                {r.issues.open.critical} critical · {r.issues.open.high} high · {r.issues.open.medium} medium · {r.issues.open.low} low · {r.issues.open.info} informational
              </CardDescription>
            </div>
            <Export kind="issues" label="Open issues CSV" />
          </CardHeader>
          {r.issues.topOpen.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">No open critical or high-severity issues.</p>
          ) : (
            <ul>
              {r.issues.topOpen.map((i) => (
                <li key={i.number} className="flex items-center gap-2 border-b px-5 py-2 text-sm last:border-0">
                  <SeverityBadge value={i.severity} />
                  <Link href={`/issues/${i.number}`} className="font-mono text-[13px] text-muted-foreground hover:text-primary">{issueRef(i.number)}</Link>
                  <span className="min-w-0 flex-1 truncate">{i.title}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground">{path(i.affectedUrl)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Issues opened in this period</CardTitle>
              <CardDescription>Most frequent types.</CardDescription>
            </div>
            <Export kind="runs" period={period} label="Runs CSV" />
          </CardHeader>
          {r.issues.topTypes.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">No new issues.</p>
          ) : (
            <Table>
              <TableBody>
                {r.issues.topTypes.map((t) => (
                  <TableRow key={t.type}>
                    <TableCell><SeverityBadge value={t.severity} /></TableCell>
                    <TableCell><Link href={`/issues?type=${t.type}&status=all`} className="hover:text-primary hover:underline">{t.title}</Link></TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(t._count._all)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
      <ApiTable rows={r.api} period={period} />
    </div>
  );
}

async function Seo({ websiteId }: { websiteId: string }) {
  const run = await latestSeoRun(websiteId);
  if (!run) return <Card><EmptyState title="No SEO audit yet" /></Card>;
  const [counts, open] = await Promise.all([seoCounts(run.id), openCountsByType(websiteId, "SEO")]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Latest audit</CardTitle>
            <CardDescription>{formatNumber(counts.all)} pages, run #{run.number}.</CardDescription>
          </div>
          <Export kind="seo" />
        </CardHeader>
        <Table>
          <TableBody>
            {(Object.keys(SEO_PROBLEMS) as SeoProblem[]).filter((k) => k !== "all").map((k) => (
              <TableRow key={k}>
                <TableCell><Link href={`/seo?problem=${k}`} className="hover:text-primary hover:underline">{SEO_PROBLEMS[k]}</Link></TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(counts[k])}</TableCell>
                <TableCell className="w-24 text-right tabular-nums text-muted-foreground">{formatPercent(counts.all ? (counts[k] / counts.all) * 100 : null)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Open SEO issues by type</CardTitle>
          <Export kind="issues" label="Issues CSV" />
        </CardHeader>
        <Table>
          <TableBody>
            {[...open.entries()].sort((a, b) => b[1] - a[1]).map(([type, n]) => (
              <TableRow key={type}>
                <TableCell>{TYPE_TITLES.get(type) && <SeverityBadge value={TYPE_TITLES.get(type)!.severity} />}</TableCell>
                <TableCell><Link href={`/issues?type=${type}`} className="hover:text-primary hover:underline">{TYPE_TITLES.get(type)?.title ?? type}</Link></TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(n)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

async function BrokenLinks({ websiteId }: { websiteId: string }) {
  const issues = await brokenLinkReport(websiteId);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>{formatNumber(issues.length)} broken internal URL{issues.length === 1 ? "" : "s"}</CardTitle>
          <CardDescription>The CSV has one row per broken URL and linking page, ready to hand to whoever edits the pages.</CardDescription>
        </div>
        <Export kind="broken-links" />
      </CardHeader>
      {issues.length === 0 ? (
        <EmptyState title="No broken internal links" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Broken URL</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Linked from</TableHead>
              <TableHead>First seen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {issues.map((i) => (
              <TableRow key={i.number}>
                <TableCell className="max-w-[60ch] truncate font-mono text-[13px]"><Link href={`/issues/${i.number}`} className="hover:text-primary">{i.affectedUrl}</Link></TableCell>
                <TableCell className="font-mono text-destructive">{i.httpStatus ?? "Error"}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber((i.details as { sourceCount?: number } | null)?.sourceCount ?? 0)}</TableCell>
                <TableCell className="text-muted-foreground"><LocalTime value={i.firstDetectedAt} mode="date" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function ApiTable({ rows, period }: { rows: Awaited<ReturnType<typeof apiReport>>; period: Period }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>API endpoints</CardTitle>
          <CardDescription>Success rate and response times in this period.</CardDescription>
        </div>
        {rows.length > 0 && <Export kind="api" period={period} />}
      </CardHeader>
      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">No API endpoints are configured.</p>
      ) : (
        <Table className="[&_td]:whitespace-nowrap">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Endpoint</TableHead>
              <TableHead className="text-right">Checks</TableHead>
              <TableHead className="text-right">Success</TableHead>
              <TableHead className="text-right">Median</TableHead>
              <TableHead className="text-right">95th pct.</TableHead>
              <TableHead>Latest failure</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => {
              const pct = e.checks ? (e.ok / e.checks) * 100 : null;
              return (
                <TableRow key={e.id}>
                  <TableCell><Link href={`/api-monitoring/${e.id}`} className="font-medium hover:text-primary hover:underline">{e.name}</Link> <span className="font-mono text-xs text-muted-foreground">{e.method}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(e.checks)}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", pct != null && pct < 99 && "text-destructive")}>{formatPercent(pct, 2)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMs(e.p50)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMs(e.p95)}</TableCell>
                  <TableCell className="max-w-[36ch] truncate text-xs text-destructive" title={e.last_error ?? ""}>{e.last_error ?? ""}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

async function Api({ websiteId, period }: { websiteId: string; period: Period }) {
  return <ApiTable rows={await apiReport(websiteId, period)} period={period} />;
}

async function Performance({ websiteId, period }: { websiteId: string; period: Period }) {
  const { pages, runs } = await performanceReport(websiteId, period);
  return (
    <div className="flex flex-col gap-4">
      {runs.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Median TTFB per run</CardTitle></CardHeader>
          <div className="flex flex-wrap gap-2 p-5">
            {runs.map((r) => (
              <Badge key={r.number} tone={r.median_ttfb > PERFORMANCE.slowTtfbMs ? "warning" : "neutral"}>#{r.number}: {formatMs(r.median_ttfb)}</Badge>
            ))}
          </div>
        </Card>
      )}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Pages, slowest first</CardTitle>
            <CardDescription>Medians over every measurement in the period. Limits: {PERFORMANCE.slowTtfbMs} ms to first byte, {PERFORMANCE.slowTotalMs / 1000} s in total.</CardDescription>
          </div>
          {pages.length > 0 && <Export kind="performance" period={period} />}
        </CardHeader>
        {pages.length === 0 ? (
          <EmptyState title="No measurements in this period" />
        ) : (
          <Table className="[&_td]:whitespace-nowrap">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Page</TableHead>
                <TableHead className="text-right">Samples</TableHead>
                <TableHead className="text-right">Median TTFB</TableHead>
                <TableHead className="text-right">Worst TTFB</TableHead>
                <TableHead className="text-right">Median total</TableHead>
                <TableHead className="text-right">HTML</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pages.map((p) => (
                <TableRow key={p.url}>
                  <TableCell className="max-w-[50ch] truncate font-mono text-[13px]" title={p.url}>{path(p.url)}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.samples}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", p.median_ttfb > PERFORMANCE.slowTtfbMs && "text-warning")}>{formatMs(p.median_ttfb)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMs(p.max_ttfb)}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", p.median_total > PERFORMANCE.slowTotalMs && "text-warning")}>{formatMs(p.median_total)}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.html_bytes ? `${Math.round(p.html_bytes / 1024)} KB` : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
