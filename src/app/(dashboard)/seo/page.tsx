import Link from "next/link";
import { FileSearch, Globe, SearchX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/layout/empty-state";
import { LocalTime } from "@/components/layout/local-time";
import { PageHeader } from "@/components/layout/page-header";
import { Pager } from "@/components/layout/pager";
import { SeverityBadge } from "@/components/issues/badges";
import { ISSUE_TYPES } from "@/lib/issue-catalog";
import { navItem } from "@/lib/navigation";
import { choice, pageNumber, param } from "@/lib/search-params";
import { cn, formatNumber } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { openCountsByType } from "@/server/issues/queries";
import { latestSeoRun, listSeoPages, SEO_PAGE_SIZE, SEO_PROBLEMS, seoCounts, type SeoProblem } from "@/server/seo/queries";
import { getActiveWebsite } from "@/server/websites/queries";

const item = navItem("/seo");
export const metadata = { title: item.label };

const SEO_TYPES = ISSUE_TYPES.filter((t) => t.category === "SEO");

function samePath(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    const strip = (u: URL) => (u.pathname.replace(/\/+$/, "") || "/") + u.search;
    return strip(x) === strip(y);
  } catch {
    return false;
  }
}

export default async function SeoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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
  const problem = choice<SeoProblem>(param(params, "problem"), SEO_PROBLEMS, "all");
  const q = (param(params, "q") ?? "").trim().slice(0, 200);
  const pageNo = pageNumber(param(params, "page"));

  const run = await latestSeoRun(website.id);
  if (!run) {
    return (
      <>
        <PageHeader title={item.label} description={item.description} />
        <Card>
          <EmptyState icon={FileSearch} title="No SEO audit yet">
            Pages are audited during every monitoring run. Run <code className="font-mono text-xs">npm run worker -- --website {website.domain}</code>.
          </EmptyState>
        </Card>
      </>
    );
  }

  const [counts, issueCounts, { total, rows }] = await Promise.all([seoCounts(run.id), openCountsByType(website.id, "SEO"), listSeoPages(run.id, problem, q, pageNo)]);
  const href = (changes: { problem?: SeoProblem; page?: number }) => {
    const p = new URLSearchParams();
    const pr = changes.problem ?? problem;
    if (pr !== "all") p.set("problem", pr);
    if (q) p.set("q", q);
    const pg = changes.page ?? 1;
    if (pg > 1) p.set("page", String(pg));
    const s = p.toString();
    return s ? `/seo?${s}` : "/seo";
  };

  return (
    <>
      <PageHeader title={item.label} description={item.description} />

      <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Pages by problem</CardTitle>
            <CardDescription>
              {formatNumber(counts.all)} pages audited in run #{run.number}, <LocalTime value={run.finishedAt ?? run.startedAt} mode="relative" />. Select a problem to list its pages.
            </CardDescription>
          </CardHeader>
          <ul className="grid sm:grid-cols-2">
            {(Object.keys(SEO_PROBLEMS) as SeoProblem[]).filter((k) => k !== "all").map((k) => (
              <li key={k} className="border-b sm:odd:border-r">
                <Link
                  href={href({ problem: k })}
                  className={cn("flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-surface-muted/60", problem === k && "bg-primary-soft text-primary")}
                  aria-current={problem === k ? "true" : undefined}
                >
                  <span>{SEO_PROBLEMS[k]}</span>
                  <span className={cn("tabular-nums", counts[k] > 0 ? "font-medium" : "text-muted-foreground")}>{formatNumber(counts[k])}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Open SEO issues</CardTitle>
            <CardDescription>Duplicates and canonical problems span several pages, so they are counted here rather than above.</CardDescription>
          </CardHeader>
          <ul className="max-h-[420px] overflow-y-auto">
            {SEO_TYPES.filter((t) => issueCounts.get(t.key)).sort((a, b) => (issueCounts.get(b.key) ?? 0) - (issueCounts.get(a.key) ?? 0)).map((t) => (
              <li key={t.key} className="border-b last:border-0">
                <Link href={`/issues?type=${t.key}`} className="flex items-center gap-2 px-5 py-2 text-sm hover:bg-surface-muted/60">
                  <SeverityBadge value={t.severity} />
                  <span className="flex-1">{t.title}</span>
                  <span className="tabular-nums font-medium">{formatNumber(issueCounts.get(t.key))}</span>
                </Link>
              </li>
            ))}
            {issueCounts.size === 0 && <li className="px-5 py-4 text-sm text-muted-foreground">No open SEO issues.</li>}
          </ul>
        </Card>
      </div>

      <Card>
        <form action="/seo" method="get" className="flex flex-col gap-2 border-b p-4 md:flex-row md:items-center" role="search">
          <label htmlFor="q" className="sr-only">Search URLs</label>
          <Input id="q" name="q" type="search" defaultValue={q} placeholder="Search URLs" className="md:max-w-sm" />
          <label htmlFor="problem" className="sr-only">Problem</label>
          <NativeSelect id="problem" name="problem" defaultValue={problem} className="md:w-64">
            {Object.entries(SEO_PROBLEMS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </NativeSelect>
          <Button type="submit" variant="outline">Apply</Button>
          {(q || problem !== "all") && <Button variant="ghost" asChild><Link href="/seo">Clear</Link></Button>}
        </form>
        {rows.length === 0 ? (
          <EmptyState icon={SearchX} title="No pages match">Nothing in the latest audit matches this filter.</EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Page</TableHead>
                <TableHead className="text-right">Title</TableHead>
                <TableHead className="text-right">Description</TableHead>
                <TableHead className="text-right">H1</TableHead>
                <TableHead>Canonical</TableHead>
                <TableHead>Indexable</TableHead>
                <TableHead>Structured data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const url = r.discoveredUrl.url;
                const titleBad = r.titleLength == null || r.titleLength === 0 || r.titleLength > 60 || r.titleLength < 30;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-[min(48ch,50vw)]">
                      <a href={url} target="_blank" rel="noreferrer" className="block truncate font-mono text-[13px] hover:text-primary" title={url}>
                        {url.replace(/^https?:\/\/[^/]+/, "") || "/"}
                      </a>
                      <p className="truncate text-xs text-muted-foreground" title={r.title ?? undefined}>{r.title ?? <em>No title</em>}</p>
                    </TableCell>
                    <TableCell className={cn("text-right tabular-nums", titleBad && "text-warning")}>{r.titleLength ?? "—"}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", !r.metaDescriptionLength && "text-warning")}>{r.metaDescriptionLength ?? "—"}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", r.h1Count !== 1 && "text-warning")}>{r.h1Count}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {!r.canonicalUrl ? <Badge tone="warning">None</Badge> : samePath(r.canonicalUrl, url) ? <Badge tone="success">Self</Badge> : <span className="font-mono text-xs" title={r.canonicalUrl}>→ {r.canonicalUrl.replace(/^https?:\/\/[^/]+/, "") || "/"}</span>}
                    </TableCell>
                    <TableCell>
                      {r.isIndexable ? <Badge tone="success">Yes</Badge> : <Badge tone="warning" title={[r.robotsMeta, r.xRobotsTag].filter(Boolean).join(" · ")}>No</Badge>}
                    </TableCell>
                    <TableCell className="max-w-[24ch] truncate text-xs text-muted-foreground" title={r.schemaTypes.join(", ")}>
                      {!r.jsonLdValid && <Badge tone="danger" className="mr-1">Invalid</Badge>}
                      {r.schemaTypes.length ? r.schemaTypes.join(", ") : "None"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <Pager page={pageNo} pageSize={SEO_PAGE_SIZE} total={total} href={(page) => href({ page })} />
      </Card>
    </>
  );
}
