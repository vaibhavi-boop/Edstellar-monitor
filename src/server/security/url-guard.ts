import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF protection. The crawler and every website/API URL an administrator
 * configures must pass through these checks. Private, loopback, link-local,
 * carrier-grade NAT, multicast and cloud-metadata addresses are refused, both
 * as literals and after DNS resolution.
 */

export class UrlGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlGuardError";
  }
}

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal", "metadata", "instance-data"]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa", ".lan", ".corp"];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0);
}

const IPV4_BLOCKED_CIDRS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, includes 169.254.169.254 cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isBlockedIPv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return IPV4_BLOCKED_CIDRS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((value & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0);
  });
}

function expandIPv6(ip: string): number[] | null {
  let address = ip.toLowerCase();
  const zone = address.indexOf("%");
  if (zone !== -1) address = address.slice(0, zone);
  const v4Match = address.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Match?.[1]) {
    const n = ipv4ToInt(v4Match[1]);
    address = address.replace(v4Match[1], `${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`);
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const parts = [...head, ...Array<string>(fill).fill("0"), ...tail];
  if (parts.length !== 8 || parts.some((p) => !/^[0-9a-f]{1,4}$/.test(p))) return null;
  return parts.map((p) => parseInt(p, 16));
}

function isBlockedIPv6(ip: string): boolean {
  const parts = expandIPv6(ip);
  if (!parts) return true; // unparsable → refuse
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0] = parts;
  if (parts.every((p) => p === 0)) return true; // ::
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0 && g === 0 && h === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d)
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && (f === 0xffff || f === 0)) {
    return isBlockedIPv4(`${g >> 8}.${g & 0xff}.${h >> 8}.${h & 0xff}`);
  }
  if (a === 0x64 && b === 0xff9b) return true; // NAT64
  if ((a & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((a & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((a & 0xff00) === 0xff00) return true; // multicast
  if (a === 0x2001 && b === 0x0db8) return true; // documentation range
  return false;
}

/** True when an IP literal points somewhere the monitor must never reach. */
export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedIPv4(ip);
  if (version === 6) return isBlockedIPv6(ip);
  return true;
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return true;
  if (isIP(host)) return isBlockedIp(host);
  // Single-label names resolve through search domains on internal networks.
  if (!host.includes(".")) return true;
  return false;
}

/**
 * Parses and checks a URL supplied by a user: http(s) on default ports only,
 * no embedded credentials, no IP literals, no internal hostnames.
 */
export function parsePublicUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new UrlGuardError("Enter a full URL, including https://");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UrlGuardError("Only http and https URLs can be monitored");
  }
  if (url.username || url.password) {
    throw new UrlGuardError("URLs with embedded usernames or passwords are not allowed");
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new UrlGuardError("Only the standard ports 80 and 443 are allowed");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) throw new UrlGuardError("Use a domain name rather than an IP address");
  if (isBlockedHostname(host)) throw new UrlGuardError("This hostname points to a private or internal network");
  return url;
}

export type Resolver = (hostname: string) => Promise<Array<{ address: string }>>;

const defaultResolver: Resolver = (hostname) => lookup(hostname, { all: true, verbatim: true });

/**
 * Resolves a hostname and refuses it if any address is private. Every record
 * is checked, not only the first, so mixed public/private answers are refused.
 */
export async function assertPublicHost(hostname: string, resolve: Resolver = defaultResolver): Promise<string[]> {
  if (isBlockedHostname(hostname)) {
    throw new UrlGuardError("This hostname points to a private or internal network");
  }
  let records: Array<{ address: string }>;
  try {
    records = await resolve(hostname);
  } catch {
    throw new UrlGuardError(`${hostname} could not be resolved. Check the spelling and the DNS records.`);
  }
  if (records.length === 0) throw new UrlGuardError(`${hostname} has no DNS address records`);
  if (records.some((r) => isBlockedIp(r.address))) {
    throw new UrlGuardError(`${hostname} resolves to a private address and cannot be monitored`);
  }
  return records.map((r) => r.address);
}

/** Monitoring domain for a hostname: lower-cased, without a leading "www.". */
export function rootDomain(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

/**
 * Crawl scope: the configured domain and (optionally) its www variant only.
 * Other subdomains are out of scope unless added as separate websites.
 */
export function isHostInScope(hostname: string, domain: string, includeWww = true): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const root = rootDomain(domain);
  return host === root || (includeWww && host === `www.${root}`);
}
