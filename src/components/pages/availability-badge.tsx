import type { Availability } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/badge";

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  UP: "Up",
  REDIRECT: "Redirect",
  CLIENT_ERROR: "Client error",
  SERVER_ERROR: "Server error",
  TIMEOUT: "Timeout",
  DNS_ERROR: "DNS error",
  SSL_ERROR: "SSL error",
  CONNECTION_ERROR: "Connection error",
  BLOCKED: "Blocked",
};

const TONES: Record<Availability, "success" | "primary" | "danger" | "warning"> = {
  UP: "success",
  REDIRECT: "primary",
  CLIENT_ERROR: "danger",
  SERVER_ERROR: "danger",
  TIMEOUT: "danger",
  DNS_ERROR: "danger",
  SSL_ERROR: "danger",
  CONNECTION_ERROR: "danger",
  BLOCKED: "warning",
};

export function AvailabilityBadge({ value }: { value: Availability | null }) {
  if (!value) return <Badge tone="neutral">Not checked</Badge>;
  return <Badge tone={TONES[value]}>{AVAILABILITY_LABELS[value]}</Badge>;
}
