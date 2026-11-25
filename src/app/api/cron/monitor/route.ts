import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enqueueDue, enqueueRun } from "@/server/engine/queue";
import { safeEqual } from "@/server/security/crypto";

/**
 * Scheduler trigger. An external scheduler (cron-job.org, Upstash QStash,
 * a CI schedule) calls this with `Authorization: Bearer $CRON_SECRET`.
 * It only queues runs; a worker does the crawling (`npm run worker -- --queue`
 * or `--loop`), because a crawl takes far longer than a serverless request.
 *
 *   POST /api/cron/monitor                       queue every website that is due
 *   POST /api/cron/monitor?website=<domain>      queue that website now (&scan=full|incremental)
 */
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16) return null;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return token.length > 0 && safeEqual(token, secret);
}

export async function POST(request: Request) {
  const ok = authorized(request);
  if (ok === null) return NextResponse.json({ error: "CRON_SECRET is not configured on the server (at least 16 characters)" }, { status: 503 });
  if (!ok) return NextResponse.json({ error: "Invalid or missing bearer token" }, { status: 401, headers: { "www-authenticate": "Bearer" } });

  const params = new URL(request.url).searchParams;
  const domain = params.get("website")?.trim().toLowerCase().replace(/^www\./, "");
  if (domain) {
    const website = await db.website.findUnique({ where: { domain }, select: { id: true, domain: true, status: true } });
    if (!website) return NextResponse.json({ error: `Unknown website ${domain}` }, { status: 404 });
    if (website.status === "PAUSED") return NextResponse.json({ error: `${domain} is paused` }, { status: 409 });
    const scanType = params.get("scan") === "incremental" ? "INCREMENTAL" : "FULL";
    const { run, created } = await enqueueRun(db, website.id, { trigger: "SCHEDULED", scanType });
    return NextResponse.json({ queued: [{ website: website.domain, run: run.number, scanType: run.scanType, created }] }, { status: 202 });
  }

  const queued = await enqueueDue(db);
  return NextResponse.json(
    { queued: queued.map((q) => ({ website: q.domain, run: q.runNumber, scanType: q.scanType, reason: q.reason, created: q.created })) },
    { status: 202 },
  );
}

export function GET() {
  return NextResponse.json({ error: "Use POST with Authorization: Bearer <CRON_SECRET>" }, { status: 405, headers: { allow: "POST" } });
}
