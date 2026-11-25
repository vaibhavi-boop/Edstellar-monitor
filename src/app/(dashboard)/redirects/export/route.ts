import { db } from "@/lib/db";
import { choice } from "@/lib/search-params";
import { getCurrentUser } from "@/server/auth/session";
import { csvCell, REDIRECT_FILTERS, redirectWhere, type RedirectFilter } from "@/server/redirects/queries";
import { getActiveWebsite } from "@/server/websites/queries";

/** CSV of the redirect inventory for the active website, honouring the screen's filter and search. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in to export redirects.", { status: 401 });
  const website = await getActiveWebsite();
  if (!website) return new Response("No website is set up.", { status: 404 });

  const params = new URL(request.url).searchParams;
  const filter = choice<RedirectFilter>(params.get("filter"), REDIRECT_FILTERS, "all");
  const q = (params.get("q") ?? "").trim().slice(0, 200);
  const rows = await db.redirect.findMany({ where: redirectWhere(website.id, filter, q), orderBy: [{ hops: "desc" }, { sourceUrl: "asc" }], take: 100_000 });

  const header = ["source_url", "status", "destination_url", "final_url", "final_status", "hops", "loop", "http_to_https", "chain", "first_seen_utc", "last_seen_utc"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    const chain = Array.isArray(r.chain) ? (r.chain as Array<{ status: number; location: string }>).map((h) => `${h.status} ${h.location}`).join(" | ") : "";
    lines.push(
      [r.sourceUrl, r.statusCode, r.destinationUrl, r.finalUrl, r.finalStatusCode, r.hops, r.isLoop, r.isHttpToHttps, chain, r.firstSeenAt.toISOString(), r.lastSeenAt.toISOString()]
        .map(csvCell)
        .join(","),
    );
  }
  const date = new Date().toISOString().slice(0, 10);
  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="redirects-${website.domain}-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
}
