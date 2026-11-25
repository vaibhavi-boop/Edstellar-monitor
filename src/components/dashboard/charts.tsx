"use client";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/layout/empty-state";
import { CATEGORY_LABELS, SEVERITY_LABELS } from "@/lib/issue-catalog";
import type { OverviewData } from "@/server/dashboard/overview";

const axis = { stroke: "var(--muted-foreground)", fontSize: 12, tickLine: false, axisLine: false } as const;
const grid = <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />;
const tooltip = (
  <Tooltip
    contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }}
    labelStyle={{ color: "var(--foreground)", fontWeight: 600 }}
    cursor={{ fill: "var(--surface-muted)" }}
  />
);
const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: "var(--sev-critical)",
  HIGH: "var(--sev-high)",
  MEDIUM: "var(--sev-medium)",
  LOW: "var(--sev-low)",
  INFO: "var(--sev-info)",
};
const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

function ChartCard({ title, description, empty, children }: { title: string; description: string; empty: string | null; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="h-64">
        {empty ? (
          <EmptyState icon={BarChart3} title="No data yet" className="h-full py-0">
            {empty}
          </EmptyState>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {children as React.ReactElement}
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

export function OverviewCharts({ charts }: { charts: OverviewData["charts"] }) {
  const noScan = "Appears after the first monitoring run.";
  const bySeverity = [...charts.bySeverity].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ChartCard title="Issues discovered" description="New issues per day, last 30 days" empty={charts.issuesOverTime.length ? null : noScan}>
        <BarChart data={charts.issuesOverTime}>
          {grid}
          <XAxis dataKey="day" tickFormatter={shortDay} {...axis} />
          <YAxis allowDecimals={false} width={32} {...axis} />
          {tooltip}
          <Bar dataKey="count" name="New issues" fill="var(--primary)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartCard>

      <ChartCard title="Open issues by severity" description="Issues that are new, open or in progress" empty={bySeverity.length ? null : "No open issues recorded."}>
        <BarChart data={bySeverity.map((s) => ({ ...s, label: SEVERITY_LABELS[s.severity] }))} layout="vertical">
          {grid}
          <XAxis type="number" allowDecimals={false} {...axis} />
          <YAxis type="category" dataKey="label" width={96} {...axis} />
          {tooltip}
          <Bar dataKey="count" name="Issues" radius={[0, 3, 3, 0]}>
            {bySeverity.map((s) => (
              <Cell key={s.severity} fill={SEVERITY_COLOR[s.severity]} />
            ))}
          </Bar>
        </BarChart>
      </ChartCard>

      <ChartCard title="Open issues by category" description="Where the open problems are" empty={charts.byCategory.length ? null : "No open issues recorded."}>
        <BarChart data={charts.byCategory.map((c) => ({ ...c, label: CATEGORY_LABELS[c.category] }))}>
          {grid}
          <XAxis dataKey="label" {...axis} interval={0} />
          <YAxis allowDecimals={false} width={32} {...axis} />
          {tooltip}
          <Bar dataKey="count" name="Issues" fill="var(--primary)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartCard>

      <ChartCard title="Availability by run" description="Share of checked URLs that responded successfully" empty={charts.availabilityHistory.length ? null : noScan}>
        <AreaChart data={charts.availabilityHistory}>
          {grid}
          <XAxis dataKey="run" {...axis} />
          <YAxis domain={[0, 100]} unit="%" width={44} {...axis} />
          {tooltip}
          <Area dataKey="pct" name="Available" unit="%" stroke="var(--success)" fill="var(--success)" fillOpacity={0.12} strokeWidth={2} />
        </AreaChart>
      </ChartCard>

      <ChartCard title="Response time" description="Average HTTP response time per day (not browser rendering time)" empty={charts.responseTrend.length ? null : noScan}>
        <LineChart data={charts.responseTrend}>
          {grid}
          <XAxis dataKey="day" tickFormatter={shortDay} {...axis} />
          <YAxis unit=" ms" width={60} {...axis} />
          {tooltip}
          <Line dataKey="avgMs" name="Average" unit=" ms" stroke="var(--primary)" strokeWidth={2} dot={false} />
        </LineChart>
      </ChartCard>

      <ChartCard title="Opened and resolved" description="Issues opened and resolved per day, last 30 days" empty={charts.openVsResolved.length ? null : "Appears once issues are opened or resolved."}>
        <BarChart data={charts.openVsResolved}>
          {grid}
          <XAxis dataKey="day" tickFormatter={shortDay} {...axis} />
          <YAxis allowDecimals={false} width={32} {...axis} />
          {tooltip}
          <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="opened" name="Opened" fill="var(--sev-high)" radius={[3, 3, 0, 0]} />
          <Bar dataKey="resolved" name="Resolved" fill="var(--success)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartCard>
    </div>
  );
}
