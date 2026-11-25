import { promises as dns } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import tls, { type PeerCertificate } from "node:tls";
import { classifyError } from "../http";

/**
 * TLS certificate and DNS check for one hostname. The TLS connection goes
 * through the guarded lookup (never a private address) and does not reject
 * bad certificates, so an invalid certificate can be inspected and reported.
 */

export interface SslResult {
  hostname: string;
  /** Connected and read a certificate. False means HTTPS itself is unavailable. */
  reachable: boolean;
  valid: boolean;
  issuer: string | null;
  subject: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  daysRemaining: number | null;
  /** Why the certificate is not trusted (chain, hostname, dates), or why the connection failed. */
  errorMessage: string | null;
}

export interface DnsResult {
  addresses: string[];
  error: string | null;
}

function name(entity: PeerCertificate["issuer"] | undefined): string | null {
  if (!entity) return null;
  return entity.CN ?? entity.O ?? null;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

export function inspectCertificate(hostname: string, lookup: LookupFunction, timeoutMs: number, now = new Date(), port = 443): Promise<SslResult> {
  return new Promise((resolve) => {
    const base = { hostname, issuer: null, subject: null, validFrom: null, validTo: null, daysRemaining: null };
    let done = false;
    const finish = (result: SslResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const socket = tls.connect({ host: hostname, servername: isIP(hostname) ? undefined : hostname, port, rejectUnauthorized: false, lookup, ALPNProtocols: ["http/1.1"] }, () => {
      const cert = socket.getPeerCertificate();
      if (!cert || !cert.valid_to) {
        finish({ ...base, reachable: true, valid: false, errorMessage: "The server sent no certificate" });
        return;
      }
      const validFrom = new Date(cert.valid_from);
      const validTo = new Date(cert.valid_to);
      const problems: string[] = [];
      if (!socket.authorized) problems.push(String(socket.authorizationError ?? "Certificate chain is not trusted"));
      const identity = tls.checkServerIdentity(hostname, cert);
      if (identity) problems.push(identity.message);
      if (validTo < now) problems.push(`Expired on ${validTo.toISOString().slice(0, 10)}`);
      if (validFrom > now) problems.push(`Not valid until ${validFrom.toISOString().slice(0, 10)}`);
      finish({
        hostname,
        reachable: true,
        valid: problems.length === 0,
        issuer: name(cert.issuer),
        subject: name(cert.subject),
        validFrom,
        validTo,
        daysRemaining: daysBetween(now, validTo),
        errorMessage: problems.length ? [...new Set(problems)].join("; ") : null,
      });
    });
    const timer = setTimeout(() => finish({ ...base, reachable: false, valid: false, errorMessage: `No TLS handshake within ${Math.round(timeoutMs / 1000)} s` }), timeoutMs);
    socket.on("error", (error) => finish({ ...base, reachable: false, valid: false, errorMessage: classifyError(error).message }));
  });
}

/** Network an address belongs to: /24 for IPv4, /48 for IPv6. */
export function networkKey(ip: string): string {
  if (ip.includes(".") && !ip.includes(":")) return ip.split(".").slice(0, 3).join(".");
  const [head = "", tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return groups.slice(0, 3).map((g) => g.replace(/^0+(?=.)/, "")).join(":");
}

/**
 * True when the host has really moved: none of the new addresses is in a network
 * the old ones used. CDNs such as Vercel rotate individual addresses within the
 * same networks all the time, which is not worth an alert.
 */
export function dnsMoved(before: string[], after: string[]): boolean {
  if (before.length === 0 || after.length === 0) return false;
  const old = new Set(before.map(networkKey));
  return !after.some((a) => old.has(networkKey(a)));
}

export async function resolveAddresses(hostname: string): Promise<DnsResult> {
  const [v4, v6] = await Promise.allSettled([dns.resolve4(hostname), dns.resolve6(hostname)]);
  const addresses = [...(v4.status === "fulfilled" ? v4.value : []), ...(v6.status === "fulfilled" ? v6.value : [])].sort();
  if (addresses.length) return { addresses, error: null };
  const reason = v4.status === "rejected" ? v4.reason : v6.status === "rejected" ? v6.reason : null;
  return { addresses: [], error: reason ? classifyError(reason).message : `${hostname} has no A or AAAA records` };
}
