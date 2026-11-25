/** Defaults applied to every new website. Mirrors the Prisma column defaults. */
export const DEFAULT_USER_AGENT = "EdstellarMonitor/1.0 (+https://www.edstellar.com)";

/**
 * The website created by `npm run db:seed`: the Vercel deployment. Its
 * robots.txt blocks every crawler (normal for staging), and its sitemap and
 * canonical tags name the production domain, so robots.txt is ignored and
 * www.edstellar.com is mapped onto the deployment as a host alias.
 */
export const EDSTELLAR_WEBSITE = {
  name: "Edstellar (Vercel)",
  url: "https://edstellar-two.vercel.app",
  domain: "edstellar-two.vercel.app",
  respectRobotsTxt: false,
  hostAliases: ["www.edstellar.com", "edstellar.com"],
} as const;
