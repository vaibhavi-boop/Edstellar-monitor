import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ExternalLink, Globe, ListTree, SearchX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatTile } from "@/components/dashboard/stat-tile";
import { EmptyState } from "@/components/layout/empty-state";
import { LocalTime } from "@/components/layout/local-time";
import { PageHeader } from "@/components/layout/page-header";
import { AddUrlForm } from "@/components/pages/add-url-form";
import { AvailabilityBadge } from "@/components/pages/availability-badge";
import { navItem } from "@/lib/navigation";
import { cn, formatMs, formatNumber } from "@/lib/utils";
import { hasRole } from "@/server/auth/roles";
import { requireUser } from "@/server/auth/session";
import {
  listPages,
  PAGE_SIZE,
  pageStats,
  parsePageFilters,
  SORTS,
  SOURCE_FILTERS,
  STATUS_FILTERS,
  type PageFilters,
  type SortKey,
} from "@/server/pages/queries";
import { getActiveWebsite } from "@/server/websites/queries";

const item = navItem("/pages");
export const metadata = { title: item.label };

const SOURCE_LABELS = { SITEMAP: "Sitemap", CRAWL: "Crawl", CANONICAL: "Canonical", MANUAL: "Manual" } as const;

function href(f: PageFilters, changes: Partial<PageFilters>): string {
  const next = { ...f, ...changes };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.status !== "all") params.set("status", next.status);
  if (next.source !== "all") params.set("source", next.source);
  if (next.sort !== "url") params.set("sort", next.sort);
  if (next.dir !== "asc") params.set("dir", next.dir);
  if (next.page > 1) params.set("page", String(next.page));
  const qs = params.toString();
  return qs ? `/pages?${qs}` : "/pages";
}

function SortHeader({ f, sort, className, children }: { f: PageFilters; sort: SortKey; className?: string; children: React.ReactNode }) {
  const active = f.sort === sort;
  const dir = active && f.dir === "asc" ? "desc" : "asc";
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

export default async function PagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const website = await getActiveWebsite();
  if (!website) {
    return (
      <>
        <PageHeader title={item.label} description={item.description} />
        <Card>
          <EmptyState icon={Globe} title="No website is set up yet">
            Add a website first; its pages appear here after the first monitoring run.
          </EmptyState>
        </Card>
      </>
    );
  }

  const f = parsePageFilters(await searchParams);
  const [stats, { total, rows }] = await Promise.all([pageStats(website.id), listPages(website.id, f)]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canAdd = hasRole(user.role, "EDITOR");
  const filtered = f.q !== "" || f.status !== "all" || f.source !== "all";
  const command = `npm run worker -- --website ${website.domain}`;

  return (
    <>
      <PageHeader title={item.label} description={item.description} />

      <Card className="mb-4">
        <div className="overflow-hidden rounded-t-lg">
          <dl className="-mb-px -mr-px grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 [&>*]:border-b [&>*]:border-r">
            <StatTile label="Discovered URLs" value={formatNumber(stats.total)} hint={stats.inactive ? `${formatNumber(stats.inactive)} no longer found` : undefined} />
            <StatTile label="Up" value={formatNumber(stats.up)} tone="success" />
            <StatTile label="Redirects" value={formatNumber(stats.redirect)} />
            <StatTile label="Failing" value={formatNumber(stats.failing)} tone="danger" />
            <StatTile label="Blocked" value={formatNumber(stats.blocked)} tone="warning" hint="robots.txt or URL guard" />
            <StatTile label="Not checked yet" value={formatNumber(stats.unchecked)} />
          </dl>
        </div>
        <p className="px-5 py-3 text-[13px] text-muted-foreground">
          {stats.lastRun ? (
            <>
              Last run #{stats.lastRun.number} ({stats.lastRun.scanType.toLowerCase()} scan): {stats.lastRun.status.toLowerCase()},{" "}
              <LocalTime value={stats.lastRun.finishedAt ?? stats.lastRun.startedAt} mode="relative" />, {formatNumber(stats.lastRun.urlsChecked)} URLs checked.
              {stats.lastRun.errorMessage && <span className="text-destructive"> {stats.lastRun.errorMessage}</span>}
            </>
          ) : (
            <>
              No run yet. Start one from a terminal with <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-xs">{command}</code>.
              Scheduled runs arrive in build phase 5.
            </>
          )}
        </p>
      </Card>

      {canAdd && (
        <Card className="mb-4">
          <CardContent className="pt-5">
            <AddUrlForm websiteId={website.id} domain={website.domain} />
          </CardContent>
        </Card>
      )}

      <Card>
        <form action="/pages" method="get" className="flex flex-col gap-2 border-b p-4 md:flex-row md:items-center" role="search">
          <label htmlFor="q" className="sr-only">Search URLs</label>
          <Input id="q" name="q" type="search" defaultValue={f.q} placeholder="Search URLs, e.g. /corporate-training" className="md:max-w-sm" />
          <label htmlFor="status" className="sr-only">Status</label>
          <NativeSelect id="status" name="status" defaultValue={f.status} className="md:w-56">
            {Object.entries(STATUS_FILTERS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </NativeSelect>
          <label htmlFor="source" className="sr-only">Source</label>
          <NativeSelect id="source" name="source" defaultValue={f.source} className="md:w-44">
            {Object.entries(SOURCE_FILTERS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </NativeSelect>
          {f.sort !== "url" && <input type="hidden" name="sort" value={f.sort} />}
          {f.dir !== "asc" && <input type="hidden" name="dir" value={f.dir} />}
          <div className="flex gap-2">
            <Button type="submit" variant="outline">Apply</Button>
            {filtered && (
              <Button variant="ghost" asChild>
                <Link href="/pages">Clear</Link>
              </Button>
            )}
          </div>
        </form>

        {rows.length === 0 ? (
          filtered ? (
            <EmptyState icon={SearchX} title="No URLs match these filters">
              Try a shorter search, or clear the filters.
            </EmptyState>
          ) : (
            <EmptyState icon={ListTree} title="No URLs discovered yet">
              Run <code className="font-mono text-xs">{command}</code> to read the sitemap, crawl the site and check every page.
            </EmptyState>
          )
        ) : (
          <Table>
            <caption className="sr-only">
              Discovered URLs, sorted by {SORTS[f.sort].toLowerCase()} {f.dir === "asc" ? "ascending" : "descending"}
            </caption>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <SortHeader f={f} sort="url">URL</SortHeader>
                <SortHeader f={f} sort="status">Status</SortHeader>
                <SortHeader f={f} sort="time" className="text-right">Response</SortHeader>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Depth</TableHead>
                <SortHeader f={f} sort="checked">Last checked</SortHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const last = r.crawlResults[0];
                const failing = r.lastAvailability && !["UP", "REDIRECT"].includes(r.lastAvailability);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-[min(56ch,60vw)]">
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="group inline-flex max-w-full items-center gap-1 font-mono text-[13px] hover:text-primary"
                        title={r.url}
                      >
                        <span className="truncate">{r.url.replace(/^https?:\/\/[^/]+/, "") || "/"}</span>
                        <ExternalLink className="size-3 shrink-0 opacity-0 group-hover:opacity-100" />
                      </a>
                      {r.lastAvailability === "REDIRECT" && last?.redirectUrl && (
                        <p className="truncate font-mono text-xs text-muted-foreground" title={last.redirectUrl}>→ {last.redirectUrl}</p>
                      )}
                      {(failing || r.lastAvailability === "BLOCKED") && last?.errorMessage && (
                        <p className={cn("truncate text-xs", failing ? "text-destructive" : "text-muted-foreground")} title={last.errorMessage}>
                          {last.errorMessage}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="mr-2 inline-block w-8 font-mono text-[13px]">{r.lastStatusCode ?? "—"}</span>
                      <AvailabilityBadge value={r.lastAvailability} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMs(r.lastResponseTimeMs)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="text-muted-foreground">{SOURCE_LABELS[r.source]}</span>
                      {r.inSitemap && r.source !== "SITEMAP" && <Badge className="ml-1.5">in sitemap</Badge>}
                      {r.isManual && r.source !== "MANUAL" && <Badge className="ml-1.5">manual</Badge>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{r.depth}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {r.lastCheckedAt ? <LocalTime value={r.lastCheckedAt} mode="relative" /> : "Not yet"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {total > 0 && (
          <nav className="flex flex-col gap-2 border-t px-4 py-3 text-[13px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between" aria-label="Pagination">
            <span>
              {formatNumber((f.page - 1) * PAGE_SIZE + 1)}–{formatNumber(Math.min(f.page * PAGE_SIZE, total))} of {formatNumber(total)}
            </span>
            <div className="flex items-center gap-2">
              {f.page > 1 ? (
                <Button variant="ghost" size="sm" asChild>
                  <Link href={href(f, { page: f.page - 1 })}><ChevronLeft /> Previous</Link>
                </Button>
              ) : (
                <Button variant="ghost" size="sm" disabled><ChevronLeft /> Previous</Button>
              )}
              <span>Page {f.page} of {pages}</span>
              {f.page < pages ? (
                <Button variant="ghost" size="sm" asChild>
                  <Link href={href(f, { page: f.page + 1 })}>Next <ChevronRight /></Link>
                </Button>
              ) : (
                <Button variant="ghost" size="sm" disabled>Next <ChevronRight /></Button>
              )}
            </div>
          </nav>
        )}
      </Card>
    </>
  );
}
