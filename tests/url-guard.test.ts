import { describe, expect, it } from "vitest";
import {
  assertPublicHost,
  isBlockedHostname,
  isBlockedIp,
  isHostInScope,
  parsePublicUrl,
  rootDomain,
  UrlGuardError,
} from "@/server/security/url-guard";

describe("isBlockedIp", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1",
    "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:a9fe:a9fe", "not-an-ip",
  ])("blocks %s", (ip) => expect(isBlockedIp(ip)).toBe(true));

  it.each(["104.18.20.1", "8.8.8.8", "172.32.0.1", "2606:4700::6810:84e5", "::ffff:8.8.8.8"])("allows %s", (ip) =>
    expect(isBlockedIp(ip)).toBe(false),
  );
});

describe("isBlockedHostname", () => {
  it.each(["localhost", "app.localhost", "db.internal", "printer.local", "intranet", "metadata.google.internal", "127.0.0.1"])(
    "blocks %s",
    (h) => expect(isBlockedHostname(h)).toBe(true),
  );
  it("allows public domains", () => expect(isBlockedHostname("www.edstellar.com")).toBe(false));
});

describe("parsePublicUrl", () => {
  it("accepts the Edstellar URL", () => expect(parsePublicUrl("https://www.edstellar.com").hostname).toBe("www.edstellar.com"));
  it.each([
    ["ftp://edstellar.com", "Only http and https"],
    ["https://user:pass@edstellar.com", "embedded usernames"],
    ["https://edstellar.com:8443", "standard ports"],
    ["http://169.254.169.254/latest/meta-data", "IP address"],
    ["http://[::1]/", "IP address"],
    ["http://localhost:80", "private or internal"],
    ["edstellar.com", "full URL"],
  ])("rejects %s", (input, message) => {
    expect(() => parsePublicUrl(input)).toThrowError(UrlGuardError);
    expect(() => parsePublicUrl(input)).toThrowError(new RegExp(message));
  });
});

describe("assertPublicHost", () => {
  it("returns addresses for public DNS answers", async () => {
    await expect(assertPublicHost("edstellar.com", async () => [{ address: "104.18.1.1" }])).resolves.toEqual(["104.18.1.1"]);
  });
  it("refuses when any answer is private (DNS rebinding style)", async () => {
    await expect(
      assertPublicHost("evil.example", async () => [{ address: "104.18.1.1" }, { address: "10.0.0.5" }]),
    ).rejects.toThrowError(/private address/);
  });
  it("reports unresolvable domains clearly", async () => {
    await expect(
      assertPublicHost("nope.example", async () => {
        throw new Error("ENOTFOUND");
      }),
    ).rejects.toThrowError(/could not be resolved/);
  });
});

describe("crawl scope", () => {
  it("derives the root domain", () => expect(rootDomain("WWW.Edstellar.com.")).toBe("edstellar.com"));
  it("includes the domain and www only", () => {
    expect(isHostInScope("edstellar.com", "edstellar.com")).toBe(true);
    expect(isHostInScope("www.edstellar.com", "edstellar.com")).toBe(true);
    expect(isHostInScope("blog.edstellar.com", "edstellar.com")).toBe(false);
    expect(isHostInScope("edstellar.com.evil.io", "edstellar.com")).toBe(false);
    expect(isHostInScope("www.edstellar.com", "edstellar.com", false)).toBe(false);
  });
});
