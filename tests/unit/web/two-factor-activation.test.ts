import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, updateMock, findByIdMock } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  updateMock: vi.fn(),
  findByIdMock: vi.fn(),
}));

vi.mock("@nojv/redis", () => ({
  getRedis: () => ({
    get: (k: string) => Promise.resolve(store.get(k) ?? null),
    set: (k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve("OK");
    },
    del: (...ks: string[]) => {
      let n = 0;
      for (const k of ks) if (store.delete(k)) n += 1;
      return Promise.resolve(n);
    },
    incr: (k: string) => {
      const next = (Number(store.get(k)) || 0) + 1;
      store.set(k, String(next));
      return Promise.resolve(next);
    },
    expire: () => Promise.resolve(1),
  }),
  keys: {
    twoFactorActivationOtp: (u: string) => `nojv:2fa:activation-otp:${u}`,
    twoFactorActivationOtpAttempts: (u: string) => `nojv:2fa:activation-otp-attempts:${u}`,
    twoFactorChangeGrant: (u: string) => `nojv:2fa:change-grant:${u}`,
  },
}));

vi.mock("@nojv/db", () => ({
  userRepo: { update: updateMock, findById: findByIdMock },
}));

import {
  clearTwoFactorChangeGrant,
  generateActivationOtp,
  hasTwoFactorChangeGrant,
  isSuperAdminSessionExpired,
  isTwoFactorActivated,
  markTwoFactorChangeGrant,
  passkeyRegistrationDenialReason,
  setTwoFactorActivated,
  storeActivationOtp,
  verifyActivationOtp,
} from "@nojv/application";

beforeEach(() => {
  store.clear();
  updateMock.mockReset().mockResolvedValue(undefined);
  findByIdMock.mockReset();
});

describe("activation OTP — generation", () => {
  it("produces a zero-padded 6-digit code", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateActivationOtp()).toMatch(/^\d{6}$/);
    }
  });
});

describe("activation OTP — verification", () => {
  it("accepts the stored code once, then reports expired (single-use)", async () => {
    await storeActivationOtp("usr_1", "123456");
    expect(await verifyActivationOtp("usr_1", "123456")).toEqual({ ok: true });
    expect(await verifyActivationOtp("usr_1", "123456")).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("reports expired when no code was stored", async () => {
    expect(await verifyActivationOtp("usr_1", "123456")).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects a wrong code as invalid without consuming the stored code", async () => {
    await storeActivationOtp("usr_1", "123456");
    expect(await verifyActivationOtp("usr_1", "000000")).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await verifyActivationOtp("usr_1", "123456")).toEqual({ ok: true });
  });

  it("locks and destroys the code after 5 failed attempts", async () => {
    await storeActivationOtp("usr_1", "123456");
    for (let i = 0; i < 4; i += 1) {
      expect(await verifyActivationOtp("usr_1", "999999")).toEqual({
        ok: false,
        reason: "invalid",
      });
    }
    expect(await verifyActivationOtp("usr_1", "999999")).toEqual({
      ok: false,
      reason: "locked",
    });
    // even the correct code no longer works — it was destroyed
    expect(await verifyActivationOtp("usr_1", "123456")).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("stores only the sha256 of the code, never the raw code", async () => {
    await storeActivationOtp("usr_1", "123456");
    for (const value of store.values()) {
      expect(value).not.toContain("123456");
    }
  });

  it("re-storing resets the attempt counter", async () => {
    await storeActivationOtp("usr_1", "111111");
    await verifyActivationOtp("usr_1", "000000");
    await verifyActivationOtp("usr_1", "000000");
    await storeActivationOtp("usr_1", "222222");
    // fresh counter — one wrong is still just invalid, not locked
    expect(await verifyActivationOtp("usr_1", "000000")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});

describe("activation flag", () => {
  it("reads twoFactorActivated from the user row", async () => {
    findByIdMock.mockResolvedValue({ twoFactorActivated: true });
    expect(await isTwoFactorActivated("usr_1")).toBe(true);
    findByIdMock.mockResolvedValue({ twoFactorActivated: false });
    expect(await isTwoFactorActivated("usr_1")).toBe(false);
    findByIdMock.mockResolvedValue(null);
    expect(await isTwoFactorActivated("usr_1")).toBe(false);
  });

  it("writes the flag through userRepo.update", async () => {
    await setTwoFactorActivated("usr_1", true);
    expect(updateMock).toHaveBeenCalledWith("usr_1", { twoFactorActivated: true });
  });
});

describe("2FA change grant", () => {
  it("marks, observes, and clears the grant", async () => {
    expect(await hasTwoFactorChangeGrant("usr_1")).toBe(false);
    await markTwoFactorChangeGrant("usr_1");
    expect(await hasTwoFactorChangeGrant("usr_1")).toBe(true);
    await clearTwoFactorChangeGrant("usr_1");
    expect(await hasTwoFactorChangeGrant("usr_1")).toBe(false);
  });
});

describe("passkey registration gate", () => {
  it("rejects when the master switch is off", () => {
    expect(
      passkeyRegistrationDenialReason({ activated: false, hasGrant: false, hasFresh: false }),
    ).toBe("not_activated");
    // even with a fresh step-up, an inactive switch blocks registration
    expect(
      passkeyRegistrationDenialReason({ activated: false, hasGrant: true, hasFresh: true }),
    ).toBe("not_activated");
  });

  it("requires a step-up (grant or fresh verification) once activated", () => {
    expect(
      passkeyRegistrationDenialReason({ activated: true, hasGrant: false, hasFresh: false }),
    ).toBe("needs_step_up");
  });

  it("allows registration with an activation grant or a fresh step-up", () => {
    expect(
      passkeyRegistrationDenialReason({ activated: true, hasGrant: true, hasFresh: false }),
    ).toBeNull();
    expect(
      passkeyRegistrationDenialReason({ activated: true, hasGrant: false, hasFresh: true }),
    ).toBeNull();
  });
});

describe("super admin session age", () => {
  const now = new Date("2026-07-10T12:00:00Z");

  it("is not expired within 24 hours", () => {
    const created = new Date(now.getTime() - 23 * 60 * 60 * 1000);
    expect(isSuperAdminSessionExpired(created, now)).toBe(false);
  });

  it("is expired past 24 hours", () => {
    const created = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    expect(isSuperAdminSessionExpired(created, now)).toBe(true);
  });
});
