import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks for the repos `checkIpLock` orchestrates. `findLastViolationAt`
// drives the log throttle (null = nothing logged recently = log is due).
const { violationLogCreate, findLastViolationAt, updateExamIpPin } = vi.hoisted(() => ({
  violationLogCreate: vi.fn(),
  findLastViolationAt: vi.fn(),
  updateExamIpPin: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  ipViolationLogRepo: {
    withTx: () => ({ create: violationLogCreate, findLastViolationAt }),
  },
  participationRepo: {
    withTx: () => ({ updateExamIpPin }),
  },
}));

import { checkIpLock, isIpInCidr, isIpInWhitelist } from "@nojv/domain";

const fakeTx = {} as never;
const fakeContext = { userId: "usr_test", examId: "exm_test" };

beforeEach(() => {
  vi.clearAllMocks();
  findLastViolationAt.mockResolvedValue(null);
});

describe("isIpInCidr", () => {
  it("matches an IP inside a /24 range", () => {
    expect(isIpInCidr("192.168.1.42", "192.168.1.0/24")).toBe(true);
  });

  it("rejects an IP outside a /24 range", () => {
    expect(isIpInCidr("192.168.2.42", "192.168.1.0/24")).toBe(false);
  });

  it("treats /0 as match-everything", () => {
    expect(isIpInCidr("8.8.8.8", "0.0.0.0/0")).toBe(true);
  });

  it("normalises IPv4-mapped IPv6 prefixes", () => {
    expect(isIpInCidr("::ffff:140.112.30.20", "140.112.0.0/16")).toBe(true);
  });

  it("rejects malformed IPs", () => {
    expect(isIpInCidr("not.an.ip.address", "10.0.0.0/8")).toBe(false);
  });

  it("matches a native IPv6 address inside a /32 range", () => {
    expect(isIpInCidr("2001:db8:1:2::1", "2001:db8::/32")).toBe(true);
  });

  it("rejects a native IPv6 address outside a /32 range", () => {
    expect(isIpInCidr("2001:dead::1", "2001:db8::/32")).toBe(false);
  });

  it("matches the IPv6 loopback inside ::1/128", () => {
    expect(isIpInCidr("::1", "::1/128")).toBe(true);
  });

  it("treats ::/0 as match-everything for IPv6", () => {
    expect(isIpInCidr("2001:db8::42", "::/0")).toBe(true);
  });

  it("rejects when the IP family does not match the CIDR family", () => {
    expect(isIpInCidr("2001:db8::1", "10.0.0.0/8")).toBe(false);
    expect(isIpInCidr("10.0.0.1", "2001:db8::/32")).toBe(false);
  });

  it("rejects malformed CIDR prefixes", () => {
    expect(isIpInCidr("2001:db8::1", "2001:db8::/129")).toBe(false);
    expect(isIpInCidr("10.0.0.1", "10.0.0.0/33")).toBe(false);
  });
});

describe("isIpInWhitelist", () => {
  it("returns true if any CIDR in the list matches", () => {
    expect(isIpInWhitelist("10.0.0.5", ["192.168.0.0/16", "10.0.0.0/24"])).toBe(true);
  });

  it("returns false on an empty whitelist", () => {
    expect(isIpInWhitelist("10.0.0.5", [])).toBe(false);
  });
});

const whitelistBlock = {
  ipWhitelistEnabled: true,
  ipBindingEnabled: false,
  ipWhitelist: ["10.0.0.0/8"],
  ipViolationMode: "block",
};

describe("checkIpLock — whitelist", () => {
  it("matching whitelist allows without logging", async () => {
    const result = await checkIpLock(fakeTx, whitelistBlock, "10.1.2.3", null, fakeContext);
    expect(result).toEqual({ allowed: true });
    expect(violationLogCreate).not.toHaveBeenCalled();
  });

  it("block mode denies AND records the violation (audit trail)", async () => {
    // Fix: previously block mode returned without ever writing IpViolationLog,
    // so a teacher using block mode got zero audit trail.
    const result = await checkIpLock(fakeTx, whitelistBlock, "1.2.3.4", null, fakeContext);
    expect(result).toEqual({ allowed: false, violationType: "whitelist" });
    expect(violationLogCreate).toHaveBeenCalledTimes(1);
  });

  it("notify mode logs and allows", async () => {
    const result = await checkIpLock(
      fakeTx,
      { ...whitelistBlock, ipViolationMode: "notify" },
      "1.2.3.4",
      null,
      fakeContext,
    );
    expect(result).toEqual({ allowed: true });
    expect(violationLogCreate).toHaveBeenCalledTimes(1);
  });

  it("suppresses the log when a recent identical violation exists (throttle)", async () => {
    findLastViolationAt.mockResolvedValue(new Date());
    const result = await checkIpLock(fakeTx, whitelistBlock, "1.2.3.4", null, fakeContext);
    expect(result).toEqual({ allowed: false, violationType: "whitelist" });
    expect(violationLogCreate).not.toHaveBeenCalled();
  });
});

const bindingBlock = {
  ipWhitelistEnabled: false,
  ipBindingEnabled: true,
  ipWhitelist: [] as string[],
  ipViolationMode: "block",
};

describe("checkIpLock — binding", () => {
  it("pins the IP on first contact and allows", async () => {
    const result = await checkIpLock(
      fakeTx,
      bindingBlock,
      "1.2.3.4",
      { id: "part_1", ipPin: null },
      fakeContext,
    );
    expect(result).toEqual({ allowed: true });
    expect(updateExamIpPin).toHaveBeenCalledWith("part_1", "1.2.3.4");
    expect(violationLogCreate).not.toHaveBeenCalled();
  });

  it("block mode denies a mismatched pin and records it", async () => {
    const result = await checkIpLock(
      fakeTx,
      bindingBlock,
      "9.9.9.9",
      { id: "part_1", ipPin: "1.2.3.4" },
      fakeContext,
    );
    expect(result).toEqual({ allowed: false, violationType: "binding" });
    expect(violationLogCreate).toHaveBeenCalledTimes(1);
    expect(updateExamIpPin).not.toHaveBeenCalled();
  });

  it("skips the gate during a teacher grace window but still re-pins", async () => {
    const now = new Date("2026-05-26T10:00:00Z");
    const result = await checkIpLock(
      fakeTx,
      bindingBlock,
      "9.9.9.9",
      { id: "part_1", ipPin: null, ipGateExemptUntil: new Date("2026-05-26T10:05:00Z") },
      fakeContext,
      now,
    );
    expect(result).toEqual({ allowed: true });
    expect(updateExamIpPin).toHaveBeenCalledWith("part_1", "9.9.9.9");
    expect(violationLogCreate).not.toHaveBeenCalled();
  });
});
