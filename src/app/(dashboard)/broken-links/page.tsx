import Link from "next/link";
import { CircleCheck, Globe } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatTile } from "@/components/dashboard/stat-tile";
import { EmptyState } from "@/components/layout/empty-state";
import { LocalTime } from "@/components/layout/local-time";
import { PageHeader } from "@/components/layout/page-header";
import { Pager } from "@/components/layout/pager";
import { db } from "@/lib/db";
import { navItem } from "@/lib/navigation";
import { choice, pageNumber, param } from "@/lib/search-params";
import { cn, formatNumber, issueRef } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { OPEN_STATUSES } from "@/server/issues/queries";
import { getActiveWebsite } from "@/server/websites/queries";

const item = navItem("/broken-links");
export const metadata = { title: item.label };
const PAGE_SIZE = 50;

const VIEWS = { target: "By broken URL", source: "By linking page", redirected: "Links to redirects" } as const;
type View = keyof typeof VIEWS;

interface LinkDetails {
  sources?: string[];
  sourceCount?: number;
  finalUrl?: string;
}

const path = (u: string) => u.replace(/^https?:\/\/[^/]+/, "") || "/";

export default async function BrokenLinksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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
  const view = choice<View>(param(params, "view"), VIEWS, "target");
  const pageNo = pageNumber(param(params, "page"));

  const type = view === "redirected" ? "links.redirected_internal" : "links.broken_internal";
  const [broken, redirected, issues] = await Promise.all([
    db.issue.count({ where: { websiteId: website.id, type: "links.broken_internal", status: { in: OPEN_STATUSES } } }),
    db.issue.count({ where: { websiteId: website.id, type: "links.redirected_internal", status: { in: OPEN_STATUSES } } }),
    db.issue.findMany({
      where: { websiteId: website.id, type, status: { in: OPEN_STATUSES } },
      orderBy: [{ severity: "asc" }, { lastDetectedAt: "desc" }],
      select: { id: true, number: true, affectedUrl: true, httpStatus: true, description: true, details: true, firstDetectedAt: true },
    }),
  ]);

  // Pages that contain broken links, from the linking pages recorded on each issue.
  const bySource = new Map<string, Array<{ number: number; url: string; status: number | null }>>();
  let sampled = false;
  for (const issue of issues) {
    const d = (issue.details ?? {}) as LinkDetails;
    if ((d.sourceCount ?? 0) > (d.sources?.length ?? 0)) sampled = true;
    for (const source of d.sources ?? []) {
      bySource.set(source, [...(bySource.get(source) ?? []), { number: issue.number, url: issue.affectedUrl ?? "", status: issue.httpStatus }]);
    }
  }
  const sources = [...bySource.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const totalLinks = issues.reduce((n, i) => n + ((i.details as LinkDetails | null)?.sourceCount ?? 0), 0);

  const listTotal = view === "source" ? sources.length : issues.length;
  const start = (pageNo - 1) * PAGE_SIZE;
  const href = (v: View, page = 1) => `/broken-links?${new URLSearchParams({ ...(v !== "target" ? { view: v } : {}), ...(page > 1 ? { page: String(page) } : {}) })}`.replace(/\?$/, "");

  return (
    <>
      <PageHeader title={item.label} description={item.description} />

      <Card className="mb-4">
        <div className="overflow-hidden rounded-lg">
          <dl className="-mb-px -mr-px grid grid-cols-2 sm:grid-cols-4 [&>*]:border-b [&>*]:border-r">
            <StatTile label="Broken URLs linked" value={formatNumber(broken)} tone="danger" />
            <StatTile label="Pages containing them" value={formatNumber(view === "redirected" ? null : bySource.size)} hint={sampled ? "At least; up to 20 per URL are recorded" : undefined} />
            <StatTile label="Links to fix" value={formatNumber(view === "redirected" ? null : totalLinks)} />
            <StatTile label="Links to redirects" value={formatNumber(redirected)} tone="warning" />
          </dl>
        </div>
      </Card>

      <Card>
        <nav className="flex gap-1 border-b px-3 pt-2" aria-label="Views">
          {(Object.keys(VIEWS) as View[]).map((v) => (
            <Link
              key={v}
              href={href(v)}
              aria-current={view === v ? "page" : undefined}
              className={cn("-mb-px border-b-2 px-3 py-2 text-sm", view === v ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              {VIEWS[v]}
            </Link>
          ))}
        </nav>

        {issues.length === 0 ? (
          <EmptyState icon={CircleCheck} title={view === "redirected" ? "No links point at redirects" : "No broken internal links"}>
            Links are checked during full scans. Only links to pages on {website.domain} are followed.
          </EmptyState>
        ) : view === "source" ? (
          <>
            <CardHeader className="border-b-0 pb-0">
              <CardDescription>Fix these pages (or the shared template they use) to remove the broken links.</CardDescription>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Page containing broken links</TableHead>
                  <TableHead className="text-right">Broken links</TableHead>
                  <TableHead>Broken URLs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.slice(start, start + PAGE_SIZE).map(([source, targets]) => (
                  <TableRow key={source}>
                    <TableCell className="max-w-[min(44ch,45vw)]">
                      <a href={source} target="_blank" rel="noreferrer" className="block truncate font-mono text-[13px] hover:text-primary" title={source}>{path(source)}</a>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{targets.length}</TableCell>
                    <TableCell className="max-w-[min(52ch,50vw)]">
                      <ul className="space-y-0.5">
                        {targets.slice(0, 5).map((t) => (
                          <li key={t.number} className="truncate font-mono text-xs">
                            <Link href={`/issues/${t.number}`} className="hover:text-primary hover:underline" title={t.url}>
                              <span className="text-destructive">{t.status ?? "ERR"}</span> {path(t.url)}
                            </Link>
                          </li>
                        ))}
                        {targets.length > 5 && <li className="text-xs text-muted-foreground">and {targets.length - 5} more</li>}
                      </ul>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-20">Issue</TableHead>
                <TableHead>{view === "redirected" ? "Linked URL → destination" : "Broken URL"}</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Linked from</TableHead>
                <TableHead>Example linking page</TableHead>
                <TableHead>First seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {issues.slice(start, start + PAGE_SIZE).map((i) => {
                const d = (i.details ?? {}) as LinkDetails;
                return (
                  <TableRow key={i.id}>
                    <TableCell className="font-mono text-[13px]"><Link href={`/issues/${i.number}`} className="text-muted-foreground hover:text-primary hover:underline">{issueRef(i.number)}</Link></TableCell>
                    <TableCell className="max-w-[min(48ch,45vw)]">
                      <a href={i.affectedUrl ?? "#"} target="_blank" rel="noreferrer" className="block truncate font-mono text-[13px] hover:text-primary" title={i.affectedUrl ?? ""}>{path(i.affectedUrl ?? "")}</a>
                      {d.finalUrl && <p className="truncate font-mono text-xs text-muted-foreground" title={d.finalUrl}>→ {path(d.finalUrl)}</p>}
                    </TableCell>
                    <TableCell className={cn("font-mono text-[13px]", view !== "redirected" && "text-destructive")}>{i.httpStatus ?? "Error"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(d.sourceCount ?? d.sources?.length ?? 0)}</TableCell>
                    <TableCell className="max-w-[min(36ch,30vw)]">
                      {d.sources?.[0] && <a href={d.sources[0]} target="_blank" rel="noreferrer" className="block truncate font-mono text-xs text-muted-foreground hover:text-primary" title={d.sources[0]}>{path(d.sources[0])}</a>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground"><LocalTime value={i.firstDetectedAt} mode="relative" /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <Pager page={pageNo} pageSize={PAGE_SIZE} total={listTotal} href={(page) => href(view, page)} />
      </Card>
      {view !== "redirected" && issues.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>How this list is built</CardTitle>
            <CardDescription>
              During a full scan every link on every page of {website.domain} is recorded, and each linked URL is checked once. A broken URL appears here
              with up to 20 of the pages that link to it; the issue page lists them. External links are not checked.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </>
  );
}
