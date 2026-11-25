import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lightbulb } from "lucide-react";
import type { OccurrenceKind } from "@/generated/prisma/enums";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LocalTime } from "@/components/layout/local-time";
import { PageHeader } from "@/components/layout/page-header";
import { IssueStatusBadge, SeverityBadge } from "@/components/issues/badges";
import { IssueStatusForm } from "@/components/issues/status-form";
import { CATEGORY_LABELS } from "@/lib/issue-catalog";
import { suggestedFix } from "@/lib/issue-fixes";
import { formatNumber, issueRef } from "@/lib/utils";
import { hasRole } from "@/server/auth/roles";
import { requireUser } from "@/server/auth/session";
import { getIssue, ISSUE_STATUS_LABELS } from "@/server/issues/queries";

export async function generateMetadata({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  return { title: /^\d+$/.test(number) ? issueRef(Number(number)) : "Issue" };
}

const KIND_LABELS: Record<OccurrenceKind, string> = {
  DETECTED: "Detected",
  REDETECTED: "Detected again",
  RECURRED: "Came back",
  AUTO_RESOLVED: "Resolved automatically",
  STATUS_CHANGED: "Status changed",
};

const LIST_LABELS: Record<string, string> = {
  sources: "Linked from",
  urls: "Pages",
  examples: "Examples",
  h1: "H1 headings",
  levels: "Empty headings",
  errors: "Errors",
};
const HIDDEN = new Set(["scope", "page", "sourceCount", "count", "chain", "missing"]);

function UrlList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1">
      {items.map((u) => (
        <li key={u} className="break-all font-mono text-[13px]">
          {/^https?:\/\//.test(u) ? (
            <a href={u} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">{u}</a>
          ) : (
            u
          )}
        </li>
      ))}
    </ul>
  );
}

function Details({ details }: { details: Record<string, unknown> }) {
  const chain = Array.isArray(details.chain) ? (details.chain as Array<{ url: string; status: number; location: string }>) : null;
  const missing = details.missing && typeof details.missing === "object" ? (details.missing as Record<string, string[]>) : null;
  const total = typeof details.sourceCount === "number" ? details.sourceCount : typeof details.count === "number" ? details.count : null;
  const entries = Object.entries(details).filter(([k]) => !HIDDEN.has(k));

  return (
    <div className="flex flex-col gap-5">
      {chain && (
        <div>
          <h3 className="mb-2 text-[13px] font-medium">Redirect chain</h3>
          <ol className="space-y-1.5 font-mono text-[13px]">
            {chain.map((hop, i) => (
              <li key={i} className="break-all">
                <span className="mr-2 inline-block w-9 text-muted-foreground">{hop.status}</span>
                {hop.url} <span className="text-muted-foreground">→</span> {hop.location}
              </li>
            ))}
            {"finalStatus" in details && (
              <li className="text-muted-foreground">Final response: {String(details.finalStatus ?? "no response")}</li>
            )}
          </ol>
        </div>
      )}
      {missing && (
        <div>
          <h3 className="mb-2 text-[13px] font-medium">Missing properties</h3>
          <ul className="space-y-1 text-sm">
            {Object.entries(missing).map(([type, props]) => (
              <li key={type}><span className="font-medium">{type}</span>: {props.join(", ")}</li>
            ))}
          </ul>
        </div>
      )}
      {entries.map(([key, value]) => {
        if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
          return (
            <div key={key}>
              <h3 className="mb-2 text-[13px] font-medium">
                {LIST_LABELS[key] ?? key}
                {total != null && total > value.length && (key === "sources" || key === "urls" || key === "examples") && (
                  <span className="font-normal text-muted-foreground"> (first {value.length} of {formatNumber(total)})</span>
                )}
              </h3>
              <UrlList items={value as string[]} />
            </div>
          );
        }
        if (value == null || typeof value === "object") return null;
        if (key === "finalStatus" && chain) return null;
        return (
          <div key={key} className="text-sm">
            <span className="text-muted-foreground">{key.replace(/([A-Z])/g, " $1").toLowerCase()}: </span>
            <span className="break-all font-mono text-[13px]">{String(value)}</span>
          </div>
        );
      })}
    </div>
  );
}

export default async function IssuePage({ params }: { params: Promise<{ number: string }> }) {
  const user = await requireUser();
  const { number } = await params;
  if (!/^\d{1,9}$/.test(number)) notFound();
  const issue = await getIssue(Number(number));
  if (!issue) notFound();
  const fix = suggestedFix(issue.type);
  const details = (issue.details ?? {}) as Record<string, unknown>;
  const canEdit = hasRole(user.role, "EDITOR");

  return (
    <>
      <Link href="/issues" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Issues
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-muted-foreground">{issueRef(issue.number)}</span>
            {issue.title}
          </span>
        }
        description={issue.description}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <dl className="grid gap-x-8 gap-y-4 p-5 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2">
                <dt className="text-[13px] text-muted-foreground">Affected URL</dt>
                <dd className="mt-0.5 break-all font-mono text-[13px]">
                  {issue.affectedUrl ? (
                    <a href={issue.affectedUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">{issue.affectedUrl}</a>
                  ) : "—"}
                </dd>
              </div>
              {issue.sourceUrl && (
                <div className="sm:col-span-2">
                  <dt className="text-[13px] text-muted-foreground">Found on</dt>
                  <dd className="mt-0.5 break-all font-mono text-[13px]">{issue.sourceUrl}</dd>
                </div>
              )}
              <div><dt className="text-[13px] text-muted-foreground">Severity</dt><dd className="mt-1"><SeverityBadge value={issue.severity} /></dd></div>
              <div><dt className="text-[13px] text-muted-foreground">Status</dt><dd className="mt-1"><IssueStatusBadge value={issue.status} /></dd></div>
              <div><dt className="text-[13px] text-muted-foreground">Category</dt><dd className="mt-0.5">{CATEGORY_LABELS[issue.category]}</dd></div>
              <div><dt className="text-[13px] text-muted-foreground">HTTP status</dt><dd className="mt-0.5 font-mono text-[13px]">{issue.httpStatus ?? "—"}</dd></div>
              <div><dt className="text-[13px] text-muted-foreground">First detected</dt><dd className="mt-0.5"><LocalTime value={issue.firstDetectedAt} /></dd></div>
              <div><dt className="text-[13px] text-muted-foreground">Last detected</dt><dd className="mt-0.5"><LocalTime value={issue.lastDetectedAt} /></dd></div>
              <div><dt className="text-[13px] text-muted-foreground">Times detected</dt><dd className="mt-0.5">{formatNumber(issue.occurrenceCount)}</dd></div>
              <div><dt className="text-[13px] text-muted-foreground">Came back after resolving</dt><dd className="mt-0.5">{formatNumber(issue.recurrenceCount)}×</dd></div>
              <div className="sm:col-span-2"><dt className="text-[13px] text-muted-foreground">Website</dt><dd className="mt-0.5">{issue.website.name} <span className="font-mono text-[13px] text-muted-foreground">{issue.website.domain}</span></dd></div>
            </dl>
          </Card>

          {fix && (
            <Card>
              <CardHeader className="flex-row items-start gap-3">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-warning" />
                <div>
                  <CardTitle>Suggested fix</CardTitle>
                  <CardDescription className="mt-1 text-sm text-foreground">{fix}</CardDescription>
                </div>
              </CardHeader>
            </Card>
          )}

          {Object.keys(details).some((k) => !["scope", "page"].includes(k)) && (
            <Card>
              <CardHeader><CardTitle>Evidence</CardTitle></CardHeader>
              <CardContent><Details details={details} /></CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
              <CardDescription>Status changes, automatic resolutions and recurrences. Re-detections only update the counters above.</CardDescription>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>When</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {issue.occurrences.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground"><LocalTime value={o.createdAt} /></TableCell>
                    <TableCell>
                      {KIND_LABELS[o.kind]}
                      {o.note && <p className="text-[13px] text-muted-foreground">{o.note}</p>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {o.fromStatus && o.toStatus && o.fromStatus !== o.toStatus
                        ? `${ISSUE_STATUS_LABELS[o.fromStatus]} → ${ISSUE_STATUS_LABELS[o.toStatus]}`
                        : o.toStatus ? ISSUE_STATUS_LABELS[o.toStatus] : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {o.actor?.name ?? (o.monitoringRun ? `Run #${o.monitoringRun.number}` : "System")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>

        <Card className="self-start">
          <CardHeader><CardTitle>Workflow</CardTitle></CardHeader>
          <CardContent>
            {canEdit ? (
              <IssueStatusForm issueId={issue.id} status={issue.status} />
            ) : (
              <p className="text-sm text-muted-foreground">Viewers can read issues. Editors and administrators change their status.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
