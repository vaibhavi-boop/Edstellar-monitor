import Link from "next/link";
import { ArrowRightLeft, Download, Globe, SearchX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/layout/empty-state";
import { LocalTime } from "@/components/layout/local-time";
import { PageHeader } from "@/components/layout/page-header";
import { Pager } from "@/components/layout/pager";
import { navItem } from "@/lib/navigation";
import { choice, pageNumber, param } from "@/lib/search-params";
import { cn, formatNumber } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { listRedirects, REDIRECT_FILTERS, REDIRECT_PAGE_SIZE, redirectCounts, type RedirectFilter } from "@/server/redirects/queries";
import { getActiveWebsite } from "@/server/websites/queries";

const item = navItem("/redirects");
export const metadata = { title: item.label };

const path = (u: string | null) => (u ? u.replace(/^https?:\/\/[^/]+/, "") || "/" : "—");

export default async function RedirectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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
  const filter = choice<RedirectFilter>(param(params, "filter"), REDIRECT_FILTERS, "all");
  const q = (param(params, "q") ?? "").trim().slice(0, 200);
  const pageNo = pageNumber(param(params, "page"));

  const [counts, { total, rows }] = await Promise.all([redirectCounts(website.id), listRedirects(website.id, filter, q, pageNo)]);
  const query = (changes: { filter?: RedirectFilter; page?: number }) => {
    const p = new URLSearchParams();
    const f = changes.filter ?? filter;
    if (f !== "all") p.set("filter", f);
    if (q) p.set("q", q);
    if ((changes.page ?? 1) > 1) p.set("page", String(changes.page));
    return p.toString();
  };
  const exportQuery = new URLSearchParams({ ...(filter !== "all" ? { filter } : {}), ...(q ? { q } : {}) }).toString();

  return (
    <>
      <PageHeader
        title={item.label}
        description={item.description}
        actions={
          counts.all > 0 && (
            <Button variant="outline" asChild>
              <a href={`/redirects/export${exportQuery ? `?${exportQuery}` : ""}`} download>
                <Download /> Export CSV
              </a>
            </Button>
          )
        }
      />

      <Card>
        <nav className="flex flex-wrap gap-1 border-b px-3 pt-2" aria-label="Filters">
          {(Object.keys(REDIRECT_FILTERS) as RedirectFilter[]).map((f) => (
            <Link
              key={f}
              href={`/redirects${query({ filter: f }) ? `?${query({ filter: f })}` : ""}`}
              aria-current={filter === f ? "page" : undefined}
              className={cn("-mb-px border-b-2 px-3 py-2 text-sm", filter === f ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              {REDIRECT_FILTERS[f]} <span className="tabular-nums text-muted-foreground">{formatNumber(counts[f])}</span>
            </Link>
          ))}
        </nav>
        <form action="/redirects" method="get" className="flex flex-col gap-2 border-b p-4 sm:flex-row" role="search">
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          <label htmlFor="q" className="sr-only">Search redirects</label>
          <Input id="q" name="q" type="search" defaultValue={q} placeholder="Search source or destination URL" className="sm:max-w-sm" />
          <Button type="submit" variant="outline">Search</Button>
        </form>

        {rows.length === 0 ? (
          counts.all === 0 ? (
            <EmptyState icon={ArrowRightLeft} title="No redirects found">
              Every checked URL answered directly. Redirects show up here after a monitoring run finds them.
            </EmptyState>
          ) : (
            <EmptyState icon={SearchX} title="No redirects match" />
          )
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Final destination</TableHead>
                <TableHead>Final status</TableHead>
                <TableHead className="text-right">Hops</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead>Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const broken = r.isLoop || r.finalStatusCode == null || r.finalStatusCode >= 400;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-[min(40ch,40vw)]">
                      <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="block truncate font-mono text-[13px] hover:text-primary" title={r.sourceUrl}>{r.sourceUrl}</a>
                    </TableCell>
                    <TableCell className="font-mono text-[13px]">{r.statusCode}</TableCell>
                    <TableCell className="max-w-[min(40ch,40vw)]">
                      <span className="block truncate font-mono text-[13px]" title={r.finalUrl ?? r.destinationUrl}>{r.finalUrl ?? r.destinationUrl}</span>
                      {r.hops > 1 && <span className="block truncate text-xs text-muted-foreground" title={r.destinationUrl}>via {path(r.destinationUrl)}</span>}
                    </TableCell>
                    <TableCell className={cn("font-mono text-[13px]", broken && "text-destructive")}>{r.isLoop ? "Loop" : r.finalStatusCode ?? "Error"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.hops}</TableCell>
                    <TableCell className="space-x-1 whitespace-nowrap">
                      {r.isLoop && <Badge tone="danger">Loop</Badge>}
                      {!r.isLoop && broken && <Badge tone="danger">Broken</Badge>}
                      {r.hops > 1 && <Badge tone="warning">Chain</Badge>}
                      {[302, 303, 307].includes(r.statusCode) && <Badge>Temporary</Badge>}
                      {r.isHttpToHttps && <Badge tone="success">HTTPS</Badge>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground"><LocalTime value={r.lastSeenAt} mode="relative" /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <Pager page={pageNo} pageSize={REDIRECT_PAGE_SIZE} total={total} href={(page) => `/redirects?${query({ page })}`} />
      </Card>
    </>
  );
}
