import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const proxyPath = join(here, "..", "..", "..", "infra", "docker", "egress-proxy", "proxy.mjs");

const { matchesAllowlist, parseAllowlist, isBlockedAddress } = (await import(
  pathToFileURL(proxyPath).href
)) as typeof import("../../../infra/docker/egress-proxy/proxy.mjs");

describe("isBlockedAddress (SSRF guard)", () => {
  it("blocks private, loopback, link-local and cloud-metadata ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fc00::1",
      "fe80::1",
      "::ffff:169.254.169.254",
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it("blocks anything that is not a valid IP (fail closed)", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
  });
});

describe("matchesAllowlist", () => {
  it("allows an exact host:port entry", () => {
    const allowlist = parseAllowlist("api.example.com:443");
    expect(matchesAllowlist(allowlist, "api.example.com", 443)).toBe(true);
  });

  it("allows a bare-host entry on default ports 80 and 443", () => {
    const allowlist = parseAllowlist("api.example.com");
    expect(matchesAllowlist(allowlist, "api.example.com", 80)).toBe(true);
    expect(matchesAllowlist(allowlist, "api.example.com", 443)).toBe(true);
  });

  it("denies a bare-host entry on a non-default port", () => {
    const allowlist = parseAllowlist("api.example.com");
    expect(matchesAllowlist(allowlist, "api.example.com", 8080)).toBe(false);
  });

  it("denies a host that is not on the list", () => {
    const allowlist = parseAllowlist("api.example.com:443");
    expect(matchesAllowlist(allowlist, "evil.example.com", 443)).toBe(false);
  });

  it("denies a listed host on a non-listed port", () => {
    const allowlist = parseAllowlist("api.example.com:443");
    expect(matchesAllowlist(allowlist, "api.example.com", 80)).toBe(false);
  });

  it("normalizes host case", () => {
    const allowlist = parseAllowlist("API.Example.COM:443");
    expect(matchesAllowlist(allowlist, "api.example.com", 443)).toBe(true);
    expect(
      matchesAllowlist(parseAllowlist("api.example.com:443"), "API.EXAMPLE.COM", 443),
    ).toBe(true);
  });

  it("normalizes a trailing dot (FQDN) on both sides", () => {
    expect(
      matchesAllowlist(parseAllowlist("api.example.com:443"), "api.example.com.", 443),
    ).toBe(true);
    expect(
      matchesAllowlist(parseAllowlist("api.example.com.:443"), "api.example.com", 443),
    ).toBe(true);
  });

  it("denies everything for an empty allowlist", () => {
    const allowlist = parseAllowlist("");
    expect(allowlist).toEqual([]);
    expect(matchesAllowlist(allowlist, "api.example.com", 443)).toBe(false);
    expect(matchesAllowlist(allowlist, "anything", 80)).toBe(false);
  });

  it("denies a non-numeric port", () => {
    const allowlist = parseAllowlist("api.example.com:443");
    expect(matchesAllowlist(allowlist, "api.example.com", Number.NaN)).toBe(false);
  });
});

describe("parseAllowlist", () => {
  it("parses multiple comma-separated entries with mixed forms", () => {
    const allowlist = parseAllowlist("api.example.com:443, files.example.org , bare.host");
    expect(matchesAllowlist(allowlist, "api.example.com", 443)).toBe(true);
    expect(matchesAllowlist(allowlist, "api.example.com", 80)).toBe(false);
    expect(matchesAllowlist(allowlist, "files.example.org", 80)).toBe(true);
    expect(matchesAllowlist(allowlist, "files.example.org", 443)).toBe(true);
    expect(matchesAllowlist(allowlist, "bare.host", 443)).toBe(true);
  });

  it("ignores blank entries and never allows an out-of-range port", () => {
    const allowlist = parseAllowlist("api.example.com:70000,,");
    expect(matchesAllowlist(allowlist, "api.example.com", 70_000)).toBe(false);
    expect(matchesAllowlist(allowlist, "api.example.com", 80)).toBe(false);
    expect(matchesAllowlist(allowlist, "api.example.com", 443)).toBe(false);
  });
});

describe("parseAllowlist IPv6 handling", () => {
  it("parses a bracketed IPv6 host with a port", () => {
    const allowlist = parseAllowlist("[::1]:443");
    expect(matchesAllowlist(allowlist, "::1", 443)).toBe(true);
    expect(matchesAllowlist(allowlist, "::1", 80)).toBe(false);
  });

  it("parses a bracketed IPv6 host with no port as default 80/443", () => {
    const allowlist = parseAllowlist("[2001:db8::1]");
    expect(matchesAllowlist(allowlist, "2001:db8::1", 80)).toBe(true);
    expect(matchesAllowlist(allowlist, "2001:db8::1", 443)).toBe(true);
    expect(matchesAllowlist(allowlist, "2001:db8::1", 8080)).toBe(false);
  });

  it("fails closed on a bare unbracketed IPv6 address (ambiguous colons dropped)", () => {
    const allowlist = parseAllowlist("::1");
    expect(allowlist).toEqual([]);
    expect(matchesAllowlist(allowlist, "::1", 443)).toBe(false);
  });

  it("fails closed on a bracketed host with a malformed port suffix", () => {
    expect(parseAllowlist("[::1]:notaport")).toEqual([]);
    expect(parseAllowlist("[::1]extra")).toEqual([]);
  });
});
