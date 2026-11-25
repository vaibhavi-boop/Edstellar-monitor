import Link from "next/link";
import { CornerDownRight, FileWarning, Globe, Map } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatTile } from "@/components/dashboard/stat-tile";
import { EmptyState } from "@/components/layout/empty-state";
import { LocalTime } from "@/components/layout/local-time";
import { PageHeader } from "@/components/layout/page-header";
import { navItem } from "@/lib/navigation";
import { formatNumber } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { sitemapOverview } from "@/server/pages/queries";
import { getActiveWebsite } from "@/server/websites/queries";

const item = navItem("/sitemap");
export const metadata = { title: item.label };

export default async function SitemapPage() {
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

  const data = await sitemapOverview(website.id);
  const robots = data.run?.summary.robots;
  const sm = data.run?.summary.sitemaps;

  return (
    <>
      <PageHeader title={item.label} description={item.description} />

      {!data.run ? (
        <Card>
          <EmptyState icon={Map} title="Sitemaps have not been read yet">
            The first monitoring run reads robots.txt and every sitemap it declares. Run{" "}
            <code className="font-mono text-xs">npm run worker -- --website {website.domain}</code>.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <div className="overflow-hidden rounded-t-lg">
              <dl className="-mb-px -mr-px grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 [&>*]:border-b [&>*]:border-r">
                <StatTile label="Sitemap files" value={formatNumber(sm?.files)} hint={sm?.invalid ? `${sm.invalid} with errors` : "All readable"} tone={sm?.invalid ? "danger" : "default"} />
                <StatTile label="URLs listed" value={formatNumber(sm?.urlsListed)} />
                <StatTile label="Listed, in scope" value={formatNumber(sm?.urlsInScope)} />
                <StatTile label="Listed, out of scope" value={formatNumber(sm?.urlsOutOfScope)} hint="Other hosts or excluded paths" tone="warning" />
                <StatTile label="Failing sitemap URLs" value={formatNumber(data.failingInSitemap)} tone="danger" />
                <StatTile label="Found only by crawling" value={formatNumber(data.notInSitemap)} hint="Live pages missing from the sitemap" />
              </dl>
            </div>
            <p className="px-5 py-3 text-[13px] text-muted-foreground">
              From run #{data.run.number}, <LocalTime value={data.run.at} mode="relative" />.{" "}
              {data.failingInSitemap > 0 && (
                <Link href="/pages?status=failing&source=SITEMAP" className="text-primary hover:underline">
                  See failing sitemap URLs
                </Link>
              )}
            </p>
          </Card>

          {robots && (
            <Card className="mb-4">
              <CardHeader>
                <CardTitle>robots.txt</CardTitle>
                <CardDescription>
                  <a href={robots.url} target="_blank" rel="noreferrer" className="font-mono text-primary hover:underline">{robots.url}</a>
                </CardDescription>
              </CardHeader>
              <dl className="grid gap-x-8 gap-y-3 px-5 pb-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-[13px] text-muted-foreground">Status</dt>
                  <dd className="mt-0.5">
                    {robots.found ? <Badge tone="success">Found (HTTP {robots.statusCode})</Badge>
                      : robots.error ? <Badge tone="danger">Unavailable</Badge>
                      : <Badge>Not present (HTTP {robots.statusCode ?? "—"})</Badge>}
                  </dd>
                </div>
                <div>
                  <dt className="text-[13px] text-muted-foreground">Rules</dt>
                  <dd className="mt-0.5">
                    {robots.ruleCount} for {robots.matchedAgent === "*" ? "all crawlers (*)" : robots.matchedAgent ?? "no matching agent"}
                    {!robots.respected && <Badge tone="warning" className="ml-2">Ignored by configuration</Badge>}
                  </dd>
                </div>
                <div>
                  <dt className="text-[13px] text-muted-foreground">Crawl-delay</dt>
                  <dd className="mt-0.5">{robots.crawlDelaySeconds != null ? `${robots.crawlDelaySeconds} s` : "None"}</dd>
                </div>
                <div>
                  <dt className="text-[13px] text-muted-foreground">Sitemaps declared</dt>
                  <dd className="mt-0.5">
                    {robots.sitemaps.length === 0 ? (
                      <span className="text-muted-foreground">None; /sitemap.xml was tried</span>
                    ) : (
                      <ul className="space-y-0.5 font-mono text-xs">
                        {robots.sitemaps.map((s) => <li key={s} className="break-all">{s}</li>)}
                      </ul>
                    )}
                  </dd>
                </div>
              </dl>
              {robots.error && <p className="border-t px-5 py-3 text-[13px] text-destructive">{robots.error}</p>}
              {(data.run.summary.hostAliases?.length ?? 0) > 0 && (
                <p className="border-t px-5 py-3 text-[13px] text-muted-foreground">
                  Sitemap URLs on {data.run.summary.hostAliases.join(", ")} are checked as the same paths on {website.domain} (host aliases).
                </p>
              )}
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Sitemap files</CardTitle>
              <CardDescription>Indexes are listed above the files they point to.</CardDescription>
            </CardHeader>
            {data.sitemaps.length === 0 ? (
              <EmptyState icon={FileWarning} title="No sitemap found">
                robots.txt declares no sitemap and /sitemap.xml is missing. Search engines then rely on links alone.
              </EmptyState>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>File</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Entries</TableHead>
                    <TableHead>HTTP</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Last read</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.sitemaps.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="max-w-[min(56ch,60vw)]">
                        <span className="flex items-center gap-1.5" style={{ paddingLeft: `${s.level * 20}px` }}>
                          {s.level > 0 && <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" />}
                          <a href={s.url} target="_blank" rel="noreferrer" className="truncate font-mono text-[13px] hover:text-primary" title={s.url}>
                            {s.url}
                          </a>
                        </span>
                        {s.errorMessage && <p className="truncate text-xs text-destructive" style={{ paddingLeft: `${s.level * 20}px` }} title={s.errorMessage}>{s.errorMessage}</p>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{s.isIndex ? "Index" : "URL set"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(s.urlCount)}</TableCell>
                      <TableCell className="font-mono text-[13px]">{s.lastStatusCode ?? "—"}</TableCell>
                      <TableCell>{s.isValid ? <Badge tone="success">Valid</Badge> : <Badge tone="danger">Error</Badge>}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        <LocalTime value={s.lastFetchedAt} mode="relative" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </>
      )}
    </>
  );
}
