import { describe, expect, it } from "vitest";

import { evaluateIpLock } from "@nojv/application";

const base = {
  ipWhitelistEnabled: false,
  ipBindingEnabled: false,
  ipWhitelist: [] as string[],
  ipViolationMode: "block",
};

describe("evaluateIpLock — whitelist", () => {
  it("allows any IP when nothing is enabled", () => {
    expect(evaluateIpLock(base, "1.2.3.4", null)).toEqual({
      allowed: true,
      shouldPin: false,
    });
  });

  it("fails closed on an enabled but empty whitelist (block)", () => {
    expect(
      evaluateIpLock({ ...base, ipWhitelistEnabled: true, ipWhitelist: [] }, "1.2.3.4", null),
    ).toEqual({ allowed: false, violationType: "whitelist", shouldPin: false });
  });

  it("notify mode allows but still flags a whitelist miss", () => {
    expect(
      evaluateIpLock(
        { ...base, ipWhitelistEnabled: true, ipWhitelist: [], ipViolationMode: "notify" },
        "1.2.3.4",
        null,
      ),
    ).toEqual({ allowed: true, violationType: "whitelist", shouldPin: false });
  });

  it("allows a matching whitelist IP with no violation", () => {
    expect(
      evaluateIpLock(
        { ...base, ipWhitelistEnabled: true, ipWhitelist: ["10.0.0.0/8"] },
        "10.1.2.3",
        null,
      ),
    ).toEqual({ allowed: true, shouldPin: false });
  });
});

describe("evaluateIpLock — binding", () => {
  it("pins on first contact (no pin yet) and allows", () => {
    expect(evaluateIpLock({ ...base, ipBindingEnabled: true }, "1.2.3.4", null)).toEqual({
      allowed: true,
      shouldPin: true,
    });
  });

  it("allows when the pinned IP matches", () => {
    expect(evaluateIpLock({ ...base, ipBindingEnabled: true }, "1.2.3.4", "1.2.3.4")).toEqual({
      allowed: true,
      shouldPin: false,
    });
  });

  it("blocks a mismatched pin in block mode", () => {
    expect(evaluateIpLock({ ...base, ipBindingEnabled: true }, "9.9.9.9", "1.2.3.4")).toEqual({
      allowed: false,
      violationType: "binding",
      shouldPin: false,
    });
  });

  it("notify mode allows but flags a mismatched pin", () => {
    expect(
      evaluateIpLock(
        { ...base, ipBindingEnabled: true, ipViolationMode: "notify" },
        "9.9.9.9",
        "1.2.3.4",
      ),
    ).toEqual({ allowed: true, violationType: "binding", shouldPin: false });
  });

  it("whitelist takes precedence over binding when both fail", () => {
    expect(
      evaluateIpLock(
        {
          ipWhitelistEnabled: true,
          ipBindingEnabled: true,
          ipWhitelist: ["10.0.0.0/8"],
          ipViolationMode: "block",
        },
        "9.9.9.9",
        "1.2.3.4",
      ),
    ).toEqual({ allowed: false, violationType: "whitelist", shouldPin: false });
  });
});

describe("evaluateIpLock — exemption", () => {
  const now = new Date("2026-05-26T10:00:00Z");

  it("skips enforcement while the grace window is open", () => {
    expect(
      evaluateIpLock({ ...base, ipBindingEnabled: true }, "9.9.9.9", "1.2.3.4", {
        exemptUntil: new Date("2026-05-26T10:05:00Z"),
        now,
      }),
    ).toEqual({ allowed: true, shouldPin: false });
  });

  it("still pins on first contact during the grace window", () => {
    expect(
      evaluateIpLock({ ...base, ipBindingEnabled: true }, "9.9.9.9", null, {
        exemptUntil: new Date("2026-05-26T10:05:00Z"),
        now,
      }),
    ).toEqual({ allowed: true, shouldPin: true });
  });

  it("resumes enforcement once the grace window expires", () => {
    expect(
      evaluateIpLock({ ...base, ipBindingEnabled: true }, "9.9.9.9", "1.2.3.4", {
        exemptUntil: new Date("2026-05-26T09:55:00Z"),
        now,
      }),
    ).toEqual({ allowed: false, violationType: "binding", shouldPin: false });
  });
});
