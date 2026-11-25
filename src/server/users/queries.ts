import "server-only";
import { db } from "@/lib/db";

export function listUsers() {
  return db.user.findMany({
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true, email: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
  });
}

export function recentAuditEntries(limit = 20) {
  return db.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { actor: { select: { name: true } } },
  });
}
