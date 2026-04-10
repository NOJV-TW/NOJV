import { describe, expect, it, vi } from "vitest";

// Hoisted mock for ipViolationLogRepo so we can assert it isn't called on the
// fail-closed path and is called once on the notify path.
const { violationLogCreate } = vi.hoisted(() => ({
  violationLogCreate: vi.fn()
}));

vi.mock("@nojv/db", () => ({
  ipViolationLogRepo: {
    withTx: () => ({ create: violationLogCreate })
  },
  contestParticipationIpRepo: {
    withTx: () => ({ updateBoundIp: vi.fn() })
  }
}));

import { checkIpLock, isIpInCidr, isIpInWhitelist } from "@nojv/domain";

const fakeTx = {} as never;
const fakeContext = { userId: "usr_test", contestId: "con_test" };

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
});

describe("isIpInWhitelist", () => {
  it("returns true if any CIDR in the list matches", () => {
    expect(isIpInWhitelist("10.0.0.5", ["192.168.0.0/16", "10.0.0.0/24"])).toBe(true);
  });

  it("returns false on an empty whitelist", () => {
    expect(isIpInWhitelist("10.0.0.5", [])).toBe(false);
  });
});

describe("checkIpLock — whitelist", () => {
  it("regression: enabled + empty whitelist denies (fail-closed)", async () => {
    // Round 2 bug: prior code skipped the whitelist check entirely when the
    // list was empty, silently allowing every IP. The fix removes the
    // `&& length > 0` guard so an empty list always fails the membership
    // test and either blocks or notify-logs.
    violationLogCreate.mockClear();
    const result = await checkIpLock(
      fakeTx,
      {
        ipWhitelistEnabled: true,
        ipBindingEnabled: false,
        ipWhitelist: [],
        ipViolationMode: "block"
      },
      "1.2.3.4",
      null,
      fakeContext
    );
    expect(result).toEqual({ allowed: false, violationType: "whitelist" });
    expect(violationLogCreate).not.toHaveBeenCalled();
  });

  it("enabled + empty whitelist in notify mode logs and allows", async () => {
    violationLogCreate.mockClear();
    const result = await checkIpLock(
      fakeTx,
      {
        ipWhitelistEnabled: true,
        ipBindingEnabled: false,
        ipWhitelist: [],
        ipViolationMode: "notify"
      },
      "1.2.3.4",
      null,
      fakeContext
    );
    expect(result).toEqual({ allowed: true });
    expect(violationLogCreate).toHaveBeenCalledTimes(1);
  });

  it("matching whitelist allows without logging", async () => {
    violationLogCreate.mockClear();
    const result = await checkIpLock(
      fakeTx,
      {
        ipWhitelistEnabled: true,
        ipBindingEnabled: false,
        ipWhitelist: ["10.0.0.0/8"],
        ipViolationMode: "block"
      },
      "10.1.2.3",
      null,
      fakeContext
    );
    expect(result).toEqual({ allowed: true });
    expect(violationLogCreate).not.toHaveBeenCalled();
  });

  it("non-matching whitelist in block mode denies", async () => {
    violationLogCreate.mockClear();
    const result = await checkIpLock(
      fakeTx,
      {
        ipWhitelistEnabled: true,
        ipBindingEnabled: false,
        ipWhitelist: ["10.0.0.0/8"],
        ipViolationMode: "block"
      },
      "1.2.3.4",
      null,
      fakeContext
    );
    expect(result).toEqual({ allowed: false, violationType: "whitelist" });
    expect(violationLogCreate).not.toHaveBeenCalled();
  });

  it("disabled whitelist allows any IP", async () => {
    violationLogCreate.mockClear();
    const result = await checkIpLock(
      fakeTx,
      {
        ipWhitelistEnabled: false,
        ipBindingEnabled: false,
        ipWhitelist: [],
        ipViolationMode: "block"
      },
      "1.2.3.4",
      null,
      fakeContext
    );
    expect(result).toEqual({ allowed: true });
    expect(violationLogCreate).not.toHaveBeenCalled();
  });
});
