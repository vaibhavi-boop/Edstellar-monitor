import { Gauge, Globe } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatTile } from "@/components/dashboard/stat-tile";
import { EmptyState } from "@/components/layout/empty-state";
import { LocalTime } from "@/components/layout/local-time";
import { PageHeader } from "@/components/layout/page-header";
import { navItem } from "@/lib/navigation";
import { PERFORMANCE } from "@/lib/thresholds";
import { cn, formatMs } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { performanceOverview } from "@/server/checks/queries";
import { getActiveWebsite, getWebsite } from "@/server/websites/queries";

const item = navItem("/performance");
export const metadata = { title: item.label };

const kb = (n: number | null) => (n == null ? "—" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)} MB` : `${Math.round(n / 1024)} KB`);
const path = (u: string) => u.replace(/^https?:\/\/[^/]+/, "") || "/";
const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)]! : null;
};

/** A stacked bar of the request phases, scaled to the slowest page. */
function Waterfall({ dns, connect, tls, ttfb, total, max }: { dns: number; connect: number; tls: number; ttfb: number; total: number; max: number }) {
  const wait = Math.max(0, ttfb - dns - connect - tls);
  const download = Math.max(0, total - ttfb);
  const pct = (v: number) => `${(v / max) * 100}%`;
  const parts: Array<[number, string, string]> = [
    [dns, "bg-sev-info", "DNS"],
    [connect, "bg-sev-low", "Connect"],
    [tls, "bg-gold", "TLS"],
    [wait, "bg-primary", "Server"],
    [download, "bg-accent", "Download"],
  ];
  return (
    <div className="flex h-2.5 w-full min-w-24 overflow-hidden rounded-sm bg-surface-muted" role="img" aria-label={parts.map(([v, , l]) => `${l} ${v} ms`).join(", ")}>
      {parts.map(([v, cls, l]) => v > 0 && <span key={l} className={cls} style={{ width: pct(v) }} title={`${l}: ${v} ms`} />)}
    </div>
  );
}

export default async function PerformancePage() {
  await requireUser();
  const active = await getActiveWebsite();
  if (!active) {
    return (
      <>
        <PageHeader title={item.label} description={item.description} />
        <Card><EmptyState icon={Globe} title="No website is set up yet" /></Card>
      </>
    );
  }
  const [data, website] = await Promise.all([performanceOverview(active.id), getWebsite(active.id)]);
  const psiEnabled = website?.configuration?.pageSpeedEnabled ?? false;

  if (!data) {
    return (
      <>
        <PageHeader title={item.label} description={item.description} />
        <Card>
          <EmptyState icon={Gauge} title="No measurements yet">
            Each monitoring run measures the home page and the {PERFORMANCE.sampleSize - 1} shallowest pages. Run{" "}
            <code className="font-mono text-xs">npm run worker -- --website {active.domain}</code>.
          </EmptyState>
        </Card>
      </>
    );
  }

  const rows = data.rows;
  const max = Math.max(...rows.map((r) => r.totalMs ?? 0), 1);
  const ttfbs = rows.map((r) => r.ttfbMs ?? 0);
  const trendMax = Math.max(...data.trend.map((t) => t.median_ttfb), PERFORMANCE.slowTtfbMs);

  return (
    <>
      <PageHeader title={item.label} description={item.description} />

      <Card className="mb-4">
        <div className="overflow-hidden rounded-t-lg">
          <dl className="-mb-px -mr-px grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 [&>*]:border-b [&>*]:border-r">
            <StatTile label="Pages measured" value={String(rows.length)} hint={`Median of ${PERFORMANCE.samplesPerPage} requests each`} />
            <StatTile label="Median TTFB" value={formatMs(median(ttfbs))} />
            <StatTile label="Slowest TTFB" value={formatMs(Math.max(...ttfbs))} tone={Math.max(...ttfbs) > PERFORMANCE.slowTtfbMs ? "warning" : "default"} />
            <StatTile label="Slow pages" value={String(rows.filter((r) => (r.ttfbMs ?? 0) > PERFORMANCE.slowTtfbMs || (r.totalMs ?? 0) > PERFORMANCE.slowTotalMs).length)} tone="warning" />
            <StatTile label="Largest HTML" value={kb(Math.max(...rows.map((r) => r.htmlBytes ?? 0)))} />
          </dl>
        </div>
        <p className="px-5 py-3 text-[13px] text-muted-foreground">
          Run #{data.runNumber}, <LocalTime value={data.checkedAt} mode="relative" />. Issues are raised above {PERFORMANCE.slowTtfbMs} ms to first byte,{" "}
          {PERFORMANCE.slowTotalMs / 1000} s in total, or {kb(PERFORMANCE.largeHtmlBytes)} of HTML. Times are measured from the monitor, not a browser.
        </p>
      </Card>

      {data.trend.length > 1 && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Median time to first byte by run</CardTitle>
            <CardDescription>The dashed line is the {PERFORMANCE.slowTtfbMs} ms limit.</CardDescription>
          </CardHeader>
          <div className="relative flex h-40 items-end gap-1.5 px-5 pb-6 pt-4">
            <div className="pointer-events-none absolute inset-x-5 border-t border-dashed border-warning" style={{ bottom: `calc(1.5rem + ${(PERFORMANCE.slowTtfbMs / trendMax) * 7.5}rem)` }} />
            {data.trend.map((t) => (
              <div key={t.number} className="flex flex-1 flex-col items-center gap-1">
                <div className={cn("w-full max-w-10 rounded-t-sm", t.median_ttfb > PERFORMANCE.slowTtfbMs ? "bg-warning" : "bg-primary")} style={{ height: `${(t.median_ttfb / trendMax) * 7.5}rem` }} title={`Run #${t.number}: ${Math.round(t.median_ttfb)} ms`} />
                <span className="text-[11px] text-muted-foreground">#{t.number}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Request timing</CardTitle>
          <CardDescription className="flex flex-wrap gap-x-4 gap-y-1">
            {[["bg-sev-info", "DNS"], ["bg-sev-low", "Connect"], ["bg-gold", "TLS"], ["bg-primary", "Server (to first byte)"], ["bg-accent", "Download"]].map(([cls, label]) => (
              <span key={label} className="inline-flex items-center gap-1.5"><span className={cn("size-2.5 rounded-sm", cls)} />{label}</span>
            ))}
          </CardDescription>
        </CardHeader>
        <Table className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Page</TableHead>
              <TableHead className="w-[28%]">Breakdown</TableHead>
              <TableHead className="text-right">DNS</TableHead>
              <TableHead className="text-right">Connect</TableHead>
              <TableHead className="text-right">TLS</TableHead>
              <TableHead className="text-right">TTFB</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">HTML</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="max-w-[min(36ch,30vw)]">
                  <a href={r.url} target="_blank" rel="noreferrer" className="block truncate font-mono text-[13px] hover:text-primary" title={r.url}>{path(r.url)}</a>
                </TableCell>
                <TableCell>
                  <Waterfall dns={r.dnsMs ?? 0} connect={r.connectMs ?? 0} tls={r.tlsMs ?? 0} ttfb={r.ttfbMs ?? 0} total={r.totalMs ?? 0} max={max} />
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{formatMs(r.dnsMs)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{formatMs(r.connectMs)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{formatMs(r.tlsMs)}</TableCell>
                <TableCell className={cn("text-right tabular-nums", (r.ttfbMs ?? 0) > PERFORMANCE.slowTtfbMs && "font-medium text-warning")}>{formatMs(r.ttfbMs)}</TableCell>
                <TableCell className={cn("text-right tabular-nums", (r.totalMs ?? 0) > PERFORMANCE.slowTotalMs && "font-medium text-warning")}>{formatMs(r.totalMs)}</TableCell>
                <TableCell className={cn("text-right tabular-nums", (r.htmlBytes ?? 0) > PERFORMANCE.largeHtmlBytes && "font-medium text-warning")}>{kb(r.htmlBytes)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>PageSpeed Insights</CardTitle>
          <CardDescription>
            {psiEnabled
              ? `Lighthouse (mobile) for up to ${PERFORMANCE.pageSpeedPages} pages per run. Needs PAGESPEED_API_KEY on the server running the worker.`
              : "Off for this website. Turn it on in the website settings and set PAGESPEED_API_KEY to collect Lighthouse scores and Core Web Vitals."}
          </CardDescription>
        </CardHeader>
        {data.pageSpeed.length === 0 ? (
          <EmptyState title="No PageSpeed reports yet" />
        ) : (
          <Table className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Page</TableHead>
                <TableHead className="text-right">Performance</TableHead>
                <TableHead className="text-right">Accessibility</TableHead>
                <TableHead className="text-right">Best practices</TableHead>
                <TableHead className="text-right">SEO</TableHead>
                <TableHead className="text-right">LCP</TableHead>
                <TableHead className="text-right">CLS</TableHead>
                <TableHead className="text-right">INP</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.pageSpeed.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-[30ch] truncate font-mono text-[13px]" title={r.url}>{path(r.url)}</TableCell>
                  {[r.performanceScore, r.accessibilityScore, r.bestPracticesScore, r.seoScore].map((s, i) => (
                    <TableCell key={i} className={cn("text-right tabular-nums", s != null && (s < PERFORMANCE.lowScore ? "text-destructive" : s < 90 ? "text-warning" : "text-success"))}>{s ?? "—"}</TableCell>
                  ))}
                  <TableCell className="text-right tabular-nums">{formatMs(r.lcpMs)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.cls ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMs(r.inpMs)}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground"><LocalTime value={r.checkedAt} mode="relative" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
