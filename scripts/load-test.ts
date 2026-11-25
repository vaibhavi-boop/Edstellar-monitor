/**
 * Load test: a full monitoring run against a synthetic 10,000-page site served
 * locally, through the real engine and database (crawl, SEO audit, checks,
 * issue reconciliation). A throwaway website is created and deleted afterwards.
 *
 *   npm run loadtest                 # 10,000 pages
 *   npm run loadtest -- 2000         # a smaller site
 *
 * The site is served from this process on 127.0.0.1, so the URL guard is
 * replaced for this run only. Expect SSL/DNS findings for 127.0.0.1 (no HTTPS
 * on a loopback address); they are part of the run, not errors.
 */
import "dotenv/config";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { PrismaClient } from "../src/generated/prisma/client";
import { createPrismaAdapter } from "../src/lib/prisma-adapter";
import { createGuardedLookup } from "../src/server/engine/http";
import { runMonitoring } from "../src/server/engine/run";

const PAGES = Number(process.argv[2] ?? 10_000);
const CATEGORIES = 25;
const BROKEN_EVERY = 500;
const filler = "<p>" + "Corporate training programmes for teams across leadership, technology and compliance. ".repeat(40) + "</p>";

function page(i: number, origin: string): string {
  const cat = i % CATEGORIES;
  const siblings = [1, 2, 3, 4, 5].map((d) => `<a href="/p/${(i + d) % PAGES}">Related ${(i + d) % PAGES}</a>`).join(" ");
  const broken = i % BROKEN_EVERY === 0 ? `<a href="/gone/${i}">Old link</a>` : "";
  return `<!doctype html><html><head><title>Course ${i}: practical training for growing teams | Load</title>
<meta name="description" content="Course ${i} in category ${cat}.">
<link rel="canonical" href="${origin}/p/${i}">
<meta property="og:title" content="Course ${i}"><meta property="og:description" content="Course ${i}"><meta property="og:image" content="${origin}/img.png">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Course","name":"Course ${i}","description":"d","provider":{"@type":"Organization","name":"Load"}}</script>
</head><body><nav><a href="/">Home</a> <a href="/c/${cat}">Category ${cat}</a></nav><h1>Course ${i}</h1><h2>Overview</h2>${filler}${siblings}${broken}</body></html>`;
}

function category(c: number): string {
  const links: string[] = [];
  for (let i = c; i < PAGES; i += CATEGORIES) links.push(`<a href="/p/${i}">Course ${i}</a>`);
  return `<!doctype html><html><head><title>Category ${c} training courses for corporate teams</title><meta name="description" content="Category ${c}"></head><body><h1>Category ${c}</h1>${links.join(" ")}</body></html>`;
}

async function main() {
  let origin = "";
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests++;
    const url = req.url ?? "/";
    const html = (status: number, body: string) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
      res.end(body);
    };
    if (url === "/") return html(200, `<!doctype html><html><head><title>Load test home page for the monitor</title></head><body><h1>Home</h1>${Array.from({ length: CATEGORIES }, (_, c) => `<a href="/c/${c}">Category ${c}</a>`).join(" ")}</body></html>`);
    if (url === "/sitemap.xml") {
      res.writeHead(200, { "content-type": "application/xml" });
      return res.end(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Array.from({ length: PAGES }, (_, i) => `<url><loc>${origin}/p/${i}</loc></url>`).join("")}</urlset>`);
    }
    const p = /^\/p\/(\d+)$/.exec(url);
    if (p && Number(p[1]) < PAGES) return html(200, page(Number(p[1]), origin));
    const c = /^\/c\/(\d+)$/.exec(url);
    if (c && Number(c[1]) < CATEGORIES) return html(200, category(Number(c[1])));
    html(404, "<h1>Not found</h1>");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const db = new PrismaClient({ adapter: createPrismaAdapter() });
  // Crawl scope is the website's domain, so the throwaway website uses the loopback host.
  if (await db.website.findUnique({ where: { domain: "127.0.0.1" } })) throw new Error("A website with domain 127.0.0.1 already exists (a crashed load test?). Delete it first.");
  const website = await db.website.create({
    data: {
      name: "Load test",
      url: origin,
      domain: "127.0.0.1",
      configuration: { create: { maxUrls: PAGES + 1000, crawlDepth: 10, concurrentRequests: 10, retryAttempts: 1, requestTimeoutMs: 15000, respectRobotsTxt: false } },
    },
  });

  console.log(`Serving ${PAGES.toLocaleString()} pages at ${origin}; running a full scan…`);
  const started = performance.now();
  let last = started;
  try {
    const report = await runMonitoring(db, website.id, {
      scanType: "FULL",
      trigger: "MANUAL",
      fetchPolicy: { checkUrl: () => {}, lookup: createGuardedLookup(async () => [{ address: "127.0.0.1" }], () => false) },
      log: (m) => {
        const now = performance.now();
        if (!m.includes("URLs checked") || now - last > 15_000) {
          console.log(`  [${((now - started) / 1000).toFixed(0).padStart(4)} s] ${m}`);
          last = now;
        }
      },
    });
    const seconds = (performance.now() - started) / 1000;
    const rows = await Promise.all([
      db.discoveredUrl.count({ where: { websiteId: website.id } }),
      db.crawlResult.count({ where: { crawlRun: { websiteId: website.id } } }),
      db.seoAuditResult.count({ where: { discoveredUrl: { websiteId: website.id } } }),
      db.issue.count({ where: { websiteId: website.id } }),
      db.issue.count({ where: { websiteId: website.id, type: "links.broken_internal" } }),
    ]);
    const maxRssMb = Math.round(process.resourceUsage().maxRSS / 1024);
    console.log("\nResult");
    console.log(`  status              ${report.status}`);
    console.log(`  URLs checked        ${report.summary.crawl.checked.toLocaleString()} (${(report.summary.crawl.checked / seconds).toFixed(1)} per second, ${requests.toLocaleString()} requests served)`);
    console.log(`  wall time           ${seconds.toFixed(1)} s`);
    console.log(`  peak memory (RSS)   ${maxRssMb} MB (worker and test server together)`);
    console.log(`  rows written        ${rows[0]} URLs, ${rows[1]} crawl results, ${rows[2]} SEO audits, ${rows[3]} issues (${rows[4]} broken-link issues; expected ${Math.ceil(PAGES / BROKEN_EVERY)})`);
  } finally {
    await db.website.delete({ where: { id: website.id } });
    console.log("Throwaway website and its data deleted.");
    await db.$disconnect();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
