import type { Role } from "@/generated/prisma/enums";

/** Role hierarchy: each role includes everything the roles below it can do. */
const RANK: Record<Role, number> = { VIEWER: 1, EDITOR: 2, ADMIN: 3 };

export function hasRole(actual: Role, required: Role): boolean {
  return RANK[actual] >= RANK[required];
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrator",
  EDITOR: "Editor",
  VIEWER: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMIN: "Manages websites, configuration and users",
  EDITOR: "Updates issue status and runs manual checks",
  VIEWER: "Reads dashboards and reports",
};
