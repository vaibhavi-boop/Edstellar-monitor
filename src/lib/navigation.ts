import {
  Activity,
  ArrowRightLeft,
  FileBarChart,
  FileSearch,
  Gauge,
  Globe,
  History,
  LayoutDashboard,
  Link2Off,
  ListTree,
  Map,
  PlugZap,
  Settings,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

/** The latest build phase that is complete. */
export const BUILT_PHASE = 2;

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** The build phase that delivers this screen. Screens with phase <= BUILT_PHASE are available. */
  phase: number;
  description: string;
}

export const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Monitor",
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard, phase: 1, description: "Health score, key numbers and trends" },
      { href: "/websites", label: "Websites", icon: Globe, phase: 1, description: "Monitored websites and their settings" },
      { href: "/pages", label: "Pages", icon: ListTree, phase: 2, description: "Every discovered URL with its latest status code, response time and source (sitemap, crawl or manual)" },
      { href: "/issues", label: "Issues", icon: TriangleAlert, phase: 3, description: "All detected issues with severity, status, occurrence history and suggested fixes" },
    ],
  },
  {
    label: "Audits",
    items: [
      { href: "/seo", label: "SEO audit", icon: FileSearch, phase: 3, description: "Titles, descriptions, headings, canonicals, indexability, structured data and social tags for every page" },
      { href: "/broken-links", label: "Broken links", icon: Link2Off, phase: 3, description: "Internal links that fail, grouped by the pages that contain them" },
      { href: "/redirects", label: "Redirect audit", icon: ArrowRightLeft, phase: 3, description: "301 and 302 redirects, chains, loops and broken destinations, with CSV export" },
      { href: "/api-monitoring", label: "API monitoring", icon: PlugZap, phase: 4, description: "Configured API endpoints with status, response time and response-shape checks" },
      { href: "/performance", label: "Performance", icon: Gauge, phase: 4, description: "DNS, connect, TLS and time-to-first-byte timings, plus optional PageSpeed scores" },
      { href: "/ssl", label: "SSL monitoring", icon: ShieldCheck, phase: 4, description: "Certificate validity, expiry countdown and DNS resolution" },
      { href: "/sitemap", label: "Sitemap", icon: Map, phase: 2, description: "Sitemap files, URL counts, robots.txt declarations and sitemap errors" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/history", label: "Monitoring history", icon: History, phase: 5, description: "Every four-hour run with duration, URLs checked and issues found or resolved" },
      { href: "/reports", label: "Reports", icon: FileBarChart, phase: 6, description: "Daily, weekly and monthly reports with CSV export" },
      { href: "/settings", label: "Settings", icon: Settings, phase: 1, description: "Your account and team access" },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

export function navItem(href: string): NavItem {
  const item = ALL_NAV_ITEMS.find((i) => i.href === href);
  if (!item) throw new Error(`Unknown nav item ${href}`);
  return item;
}

export function isActivePath(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
