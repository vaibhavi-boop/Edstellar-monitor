import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Liveness + database check for uptime probes. Reveals no configuration. */
export async function GET() {
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", database: "ok", latencyMs: Date.now() - started, time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ status: "degraded", database: "unreachable", time: new Date().toISOString() }, { status: 503 });
  }
}
