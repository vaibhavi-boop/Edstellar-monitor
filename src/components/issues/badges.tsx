import type { IssueStatus, Severity } from "@/generated/prisma/enums";
import { SEVERITY_LABELS } from "@/lib/issue-catalog";
import { Badge } from "@/components/ui/badge";

const SEVERITY_TONES: Record<Severity, "danger" | "warning" | "primary" | "neutral"> = {
  CRITICAL: "danger",
  HIGH: "danger",
  MEDIUM: "warning",
  LOW: "primary",
  INFO: "neutral",
};

export function SeverityBadge({ value }: { value: Severity }) {
  return (
    <Badge tone={SEVERITY_TONES[value]} className={value === "CRITICAL" ? "font-semibold uppercase tracking-wide" : undefined}>
      {SEVERITY_LABELS[value]}
    </Badge>
  );
}

const STATUS: Record<IssueStatus, { label: string; tone: "primary" | "warning" | "success" | "neutral" | "danger" }> = {
  NEW: { label: "New", tone: "danger" },
  OPEN: { label: "Open", tone: "warning" },
  IN_PROGRESS: { label: "In progress", tone: "primary" },
  RESOLVED: { label: "Resolved", tone: "success" },
  IGNORED: { label: "Ignored", tone: "neutral" },
};

export function IssueStatusBadge({ value }: { value: IssueStatus }) {
  return <Badge tone={STATUS[value].tone}>{STATUS[value].label}</Badge>;
}
