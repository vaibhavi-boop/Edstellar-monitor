import Link from "next/link";
import { ArrowDown, ArrowUp, CircleCheck, Globe, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatTile } from "@/components/dashboard/stat-tile";
import { EmptyState } from "@/components/layout/empty-state";
import { LocalTime } from "@/components/layout/local-time";
import { PageHeader } from "@/components/layout/page-header";
import { Pager } from "@/components/layout/pager";
import { IssueStatusBadge, SeverityBadge } from "@/components/issues/badges";
import { CATEGORY_LABELS, ISSUE_TYPES, SEVERITY_LABELS } from "@/lib/issue-catalog";
import { navItem } from "@/lib/navigation";
import { formatNumber, issueRef } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { ISSUE_PAGE_SIZE, ISSUE_SORTS, issueSummary, listIssues, parseIssueFilters, STATUS_VIEWS, type IssueFilters } from "@/server/issues/queries";
import { getActiveWebsite } from "@/server/websites/queries";

const item = navItem("/issues");
export const metadata = { title: item.label };

function href(f: IssueFilters, changes: Partial<IssueFilters>): string {
  const n = { ...f, ...changes };
  const p = new URLSearchParams();
  if (n.status !== "open") p.set("status", n.status);
  if (n.severity !== "all") p.set("severity", n.severity);
  if (n.category !== "all") p.set("category", n.category);
  if (n.type) p.set("type", n.type);
  if (n.q) p.set("q", n.q);
  if (n.sort !== "severity") p.set("sort", n.sort);
  if (n.dir !== (n.sort === "severity" ? "asc" : "desc")) p.set("dir", n.dir);
  if (n.page > 1) p.set("page", String(n.page));
  const qs = p.toString();
  return qs ? `/issues?${qs}` : "/issues";
}

function SortHeader({ f, sort, className, children }: { f: IssueFilters; sort: IssueFilters["sort"]; className?: string; children: React.ReactNode }) {
  const active = f.sort === sort;
  const natural = sort === "severity" ? "asc" : "desc";
  const dir = active ? (f.dir === "asc" ? "desc" : "asc") : natural;
  const Icon = f.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className} aria-sort={active ? (f.dir === "asc" ? "ascending" : "descending") : undefined}>
      <Link href={href(f, { sort, dir, page: 1 })} className="inline-flex items-center gap-1 hover:text-foreground">
        {children}
        {active && <Icon className="size-3" />}
      </Link>
    </TableHead>
  );
}

export default async function IssuesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const website = await getActiveWebsite();
  if (!website) {
    return (
      <>
        <PageHeader title={item.label} description={item.description} />
        <Card>
          <EmptyState icon={Globe} title="No website is set up yet" />
        </Card>
      </>
    );
  }

  const f = parseIssueFilters(await searchParams);
  const [summary, { total, rows }] = await Promise.all([issueSummary(website.id), listIssues(website.id, f)]);
  const filtered = f.status !== "open" || f.severity !== "all" || f.category !== "all" || f.type !== "" || f.q !== "";
  const typesInCategory = f.category === "all" ? ISSUE_TYPES : ISSUE_TYPES.filter((t) => t.category === f.category);

  return (
    <>
      <PageHeader title={item.label} description={item.description} />

      <Card className="mb-4">
        <div className="overflow-hidden rounded-lg">
          <dl className="-mb-px -mr-px grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 [&>*]:border-b [&>*]:border-r">
            <StatTile label="Open issues" value={formatNumber(summary.open)} />
            <StatTile label="Critical" value={formatNumber(summary.critical)} tone="danger" />
            <StatTile label="High" value={formatNumber(summary.high)} tone="danger" />
            <StatTile label="Medium" value={formatNumber(summary.medium)} tone="warning" />
            <StatTile label="New this week" value={formatNumber(summary.newWeek)} />
            <StatTile label="Resolved this week" value={formatNumber(summary.resolvedWeek)} tone="success" />
          </dl>
        </div>
      </Card>

      <Card>
        <form action="/issues" method="get" className="grid gap-2 border-b p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))_auto]" role="search">
          <label htmlFor="q" className="sr-only">Search issues</label>
          <Input id="q" name="q" type="search" defaultValue={f.q} placeholder="Search title or URL, or EM-123" />
          <label htmlFor="status" className="sr-only">Status</label>
          <NativeSelect id="status" name="status" defaultValue={f.status}>
            {Object.entries(STATUS_VIEWS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </NativeSelect>
          <label htmlFor="severity" className="sr-only">Severity</label>
          <NativeSelect id="severity" name="severity" defaultValue={f.severity}>
            <option value="all">All severities</option>
            {Object.entries(SEVERITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </NativeSelect>
          <label htmlFor="category" className="sr-only">Category</label>
          <NativeSelect id="category" name="category" defaultValue={f.category}>
            <option value="all">All categories</option>
            {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </NativeSelect>
          <label htmlFor="type" className="sr-only">Issue type</label>
          <NativeSelect id="type" name="type" defaultValue={f.type}>
            <option value="">All types</option>
            {typesInCategory.map((t) => <option key={t.key} value={t.key}>{t.title}</option>)}
          </NativeSelect>
          {f.sort !== "severity" && <input type="hidden" name="sort" value={f.sort} />}
          <div className="flex gap-2">
            <Button type="submit" variant="outline">Apply</Button>
            {filtered && (
              <Button variant="ghost" asChild>
                <Link href="/issues">Clear</Link>
              </Button>
            )}
          </div>
        </form>

        {rows.length === 0 ? (
          filtered ? (
            <EmptyState icon={SearchX} title="No issues match these filters">Clear the filters to see every open issue.</EmptyState>
          ) : (
            <EmptyState icon={CircleCheck} title="No open issues">
              Issues appear here after a monitoring run. Run <code className="font-mono text-xs">npm run worker -- --website {website.domain}</code> to check the site now.
            </EmptyState>
          )
        ) : (
          <Table>
            <caption className="sr-only">Issues sorted by {ISSUE_SORTS[f.sort].toLowerCase()}</caption>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-20">ID</TableHead>
                <TableHead>Issue</TableHead>
                <SortHeader f={f} sort="severity">Severity</SortHeader>
                <TableHead>Status</TableHead>
                <SortHeader f={f} sort="first">First seen</SortHeader>
                <SortHeader f={f} sort="last">Last seen</SortHeader>
                <SortHeader f={f} sort="count" className="text-right">Seen</SortHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap font-mono text-[13px] text-muted-foreground">
                    <Link href={`/issues/${r.number}`} className="hover:text-primary hover:underline">{issueRef(r.number)}</Link>
                  </TableCell>
                  <TableCell className="max-w-[min(60ch,60vw)]">
                    <Link href={`/issues/${r.number}`} className="font-medium hover:text-primary hover:underline">{r.title}</Link>
                    <span className="ml-2 text-xs text-muted-foreground">{CATEGORY_LABELS[r.category]}</span>
                    {r.affectedUrl && <p className="truncate font-mono text-xs text-muted-foreground" title={r.affectedUrl}>{r.affectedUrl}</p>}
                  </TableCell>
                  <TableCell><SeverityBadge value={r.severity} /></TableCell>
                  <TableCell className="whitespace-nowrap">
                    <IssueStatusBadge value={r.status} />
                    {r.recurrenceCount > 0 && <span className="ml-1.5 text-xs text-muted-foreground" title="Times it came back after being resolved">↻{r.recurrenceCount}</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground"><LocalTime value={r.firstDetectedAt} mode="relative" /></TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground"><LocalTime value={r.lastDetectedAt} mode="relative" /></TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatNumber(r.occurrenceCount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pager page={f.page} pageSize={ISSUE_PAGE_SIZE} total={total} href={(page) => href(f, { page })} />
      </Card>
    </>
  );
}
