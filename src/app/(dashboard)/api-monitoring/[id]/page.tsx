import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatTile } from "@/components/dashboard/stat-tile";
import { EmptyState } from "@/components/layout/empty-state";
import { LocalTime } from "@/components/layout/local-time";
import { PageHeader } from "@/components/layout/page-header";
import { CheckNowButton, DeleteEndpointButton } from "@/components/api/endpoint-actions";
import { EndpointForm } from "@/components/api/endpoint-form";
import { ISSUE_TYPES } from "@/lib/issue-catalog";
import { formatMs, formatPercent } from "@/lib/utils";
import { getEndpoint } from "@/server/api-endpoints/queries";
import { hasRole } from "@/server/auth/roles";
import { requireUser } from "@/server/auth/session";

export const metadata = { title: "API endpoint" };
const TYPE_TITLES = new Map(ISSUE_TYPES.map((t) => [t.key, t.title]));

export default async function EndpointPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { created } = await searchParams;
  const endpoint = await getEndpoint(id);
  if (!endpoint) notFound();
  const isAdmin = user.role === "ADMIN";
  const results = endpoint.results;
  const okCount = results.filter((r) => r.ok).length;
  const timed = results.filter((r) => r.responseTimeMs != null).map((r) => r.responseTimeMs!);
  const sorted = [...timed].sort((a, b) => a - b);
  const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]! : null;

  return (
    <>
      <Link href="/api-monitoring" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> API monitoring
      </Link>
      <PageHeader
        title={endpoint.name}
        description={<span className="break-all font-mono text-[13px]"><span className="font-semibold">{endpoint.method}</span> {endpoint.url}</span>}
        actions={
          <>
            {hasRole(user.role, "EDITOR") && <CheckNowButton endpointId={endpoint.id} />}
            {isAdmin && <DeleteEndpointButton endpointId={endpoint.id} name={endpoint.name} />}
          </>
        }
      />
      {created && <p role="status" className="mb-4 rounded-md bg-success-soft px-3 py-2 text-sm text-success">Endpoint added. Use “Check now” to test it, or wait for the next monitoring run.</p>}

      <Card className="mb-4">
        <div className="overflow-hidden rounded-lg">
          <dl className="-mb-px -mr-px grid grid-cols-2 sm:grid-cols-4 [&>*]:border-b [&>*]:border-r">
            <StatTile label="Latest" value={results[0] ? (results[0].ok ? "Passing" : "Failing") : "—"} tone={results[0] ? (results[0].ok ? "success" : "danger") : "default"} />
            <StatTile label="Success (last 50)" value={formatPercent(results.length ? (okCount / results.length) * 100 : null)} />
            <StatTile label="Median response" value={formatMs(sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null)} />
            <StatTile label="95th percentile" value={formatMs(p95)} />
          </dl>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Recent checks</CardTitle>
            <CardDescription>Expected HTTP {endpoint.expectedStatus}{endpoint.expectedFields.length ? ` with ${endpoint.expectedFields.join(", ")}` : ""}.</CardDescription>
          </CardHeader>
          {results.length === 0 ? (
            <EmptyState title="Not checked yet" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>When</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground"><LocalTime value={r.checkedAt} /></TableCell>
                    <TableCell className="max-w-[36ch]">
                      {r.ok ? <Badge tone="success">{r.statusCode} OK</Badge> : <Badge tone="danger">{r.statusCode ?? "No response"}</Badge>}
                      {!r.ok && (
                        <p className="truncate text-xs text-destructive" title={r.errorMessage ?? ""}>
                          {r.errorType ? `${TYPE_TITLES.get(r.errorType) ?? r.errorType}: ` : ""}{r.errorMessage}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatMs(r.responseTimeMs)}</TableCell>
                    <TableCell className="text-muted-foreground">{r.monitoringRunId ? "Run" : "Manual"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Settings</CardTitle>
            <CardDescription>{isAdmin ? "Changes apply from the next check." : "Only administrators can change endpoints."}</CardDescription>
          </CardHeader>
          <EndpointForm
            websiteId={endpoint.websiteId}
            canEdit={isAdmin}
            endpoint={{
              id: endpoint.id,
              name: endpoint.name,
              url: endpoint.url,
              method: endpoint.method,
              headers: (endpoint.headers ?? {}) as Record<string, string>,
              authType: endpoint.authType,
              hasCredentials: endpoint.hasCredentials,
              requestBody: endpoint.requestBody,
              expectedStatus: endpoint.expectedStatus,
              expectedFields: endpoint.expectedFields,
              timeoutMs: endpoint.timeoutMs,
              frequencyMinutes: endpoint.frequencyMinutes,
              isActive: endpoint.isActive,
            }}
          />
        </Card>
      </div>
    </>
  );
}
