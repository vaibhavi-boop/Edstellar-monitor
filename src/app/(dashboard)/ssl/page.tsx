import { Globe, ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/layout/empty-state";
import { LocalTime } from "@/components/layout/local-time";
import { PageHeader } from "@/components/layout/page-header";
import { navItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { sslOverview } from "@/server/checks/queries";
import { getActiveWebsite } from "@/server/websites/queries";

const item = navItem("/ssl");
export const metadata = { title: item.label };

export default async function SslPage() {
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
  const { latest, history, warningDays } = await sslOverview(website.id);
  if (!latest) {
    return (
      <>
        <PageHeader title={item.label} description={item.description} />
        <Card>
          <EmptyState icon={ShieldCheck} title="Not checked yet">
            The certificate and DNS records are checked on every monitoring run. Run <code className="font-mono text-xs">npm run worker -- --website {website.domain}</code>.
          </EmptyState>
        </Card>
      </>
    );
  }

  const thresholds = [...warningDays].sort((a, b) => b - a);
  const days = latest.daysRemaining;
  const warn = days != null && days <= Math.max(...thresholds);
  const lifetime = latest.validFrom && latest.validTo ? (latest.validTo.getTime() - latest.validFrom.getTime()) / 86_400_000 : null;
  const used = lifetime && days != null ? Math.min(100, Math.max(0, ((lifetime - days) / lifetime) * 100)) : null;
  const tone = !latest.valid || (days != null && days < 0) ? "danger" : warn ? "warning" : "success";
  const Icon = tone === "success" ? ShieldCheck : ShieldAlert;

  return (
    <>
      <PageHeader title={item.label} description={item.description} />
      <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
            <div className={cn("flex size-16 shrink-0 items-center justify-center rounded-full", tone === "success" ? "bg-success-soft text-success" : tone === "warning" ? "bg-warning-soft text-warning" : "bg-destructive-soft text-destructive")}>
              <Icon className="size-8" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-[family-name:var(--font-heading)] text-[28px] font-semibold leading-none tracking-[-0.02em]">
                {days == null ? "—" : days < 0 ? `Expired ${-days} days ago` : `${days} days left`}
              </p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {latest.valid ? "Valid and trusted" : `Not valid: ${latest.errorMessage ?? "unknown problem"}`} · {latest.hostname}
              </p>
              {used != null && (
                <div className="mt-3">
                  <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
                    <div className={cn("h-full rounded-full", tone === "success" ? "bg-success" : tone === "warning" ? "bg-warning" : "bg-destructive")} style={{ width: `${used}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{Math.round(used)}% of the certificate's {Math.round(lifetime!)}-day lifetime used</p>
                </div>
              )}
            </div>
          </div>
          <dl className="grid gap-x-8 gap-y-3 border-t p-5 text-sm sm:grid-cols-2">
            <div><dt className="text-[13px] text-muted-foreground">Issued to</dt><dd className="mt-0.5 font-mono text-[13px]">{latest.subject ?? "—"}</dd></div>
            <div><dt className="text-[13px] text-muted-foreground">Issuer</dt><dd className="mt-0.5">{latest.issuer ?? "—"}</dd></div>
            <div><dt className="text-[13px] text-muted-foreground">Valid from</dt><dd className="mt-0.5"><LocalTime value={latest.validFrom} mode="date" /></dd></div>
            <div><dt className="text-[13px] text-muted-foreground">Expires</dt><dd className="mt-0.5"><LocalTime value={latest.validTo} mode="date" /></dd></div>
            <div><dt className="text-[13px] text-muted-foreground">Warnings at</dt><dd className="mt-0.5">{thresholds.join(", ")} days before expiry</dd></div>
            <div><dt className="text-[13px] text-muted-foreground">Checked</dt><dd className="mt-0.5"><LocalTime value={latest.checkedAt} mode="relative" /></dd></div>
          </dl>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>DNS</CardTitle>
            <CardDescription>A and AAAA records of {latest.hostname}. A change is reported only when the host moves to different networks; CDNs rotate individual addresses routinely.</CardDescription>
          </CardHeader>
          <ul className="space-y-1 p-5 font-mono text-[13px]">
            {latest.dnsAddresses.length ? latest.dnsAddresses.map((a) => <li key={a}>{a}</li>) : <li className="text-destructive">No addresses</li>}
          </ul>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>History</CardTitle></CardHeader>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Checked</TableHead>
              <TableHead>Run</TableHead>
              <TableHead>Certificate</TableHead>
              <TableHead className="text-right">Days left</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>DNS addresses</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.map((c, i) => {
              const prev = history[i + 1];
              const dnsChanged = prev && prev.dnsAddresses.join() !== c.dnsAddresses.join();
              const certChanged = prev && prev.validTo?.getTime() !== c.validTo?.getTime();
              return (
                <TableRow key={c.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground"><LocalTime value={c.checkedAt} /></TableCell>
                  <TableCell className="text-muted-foreground">{c.monitoringRun ? `#${c.monitoringRun.number}` : "—"}</TableCell>
                  <TableCell>
                    {c.valid ? <Badge tone="success">Valid</Badge> : <Badge tone="danger" title={c.errorMessage ?? ""}>Invalid</Badge>}
                    {certChanged && <Badge tone="primary" className="ml-1.5">Renewed</Badge>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.daysRemaining ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground"><LocalTime value={c.validTo} mode="date" /></TableCell>
                  <TableCell className={cn("font-mono text-xs", dnsChanged && "text-warning")}>{c.dnsAddresses.join(", ") || "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
