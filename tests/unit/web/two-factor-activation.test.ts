import { beforeEach, describe, expect, it, vi } from "vitest";

const { evalMock, store, updateMock, findByIdMock, generationMatchesMock } = vi.hoisted(() => ({
  evalMock: vi.fn(),
  store: new Map<string, string>(),
  updateMock: vi.fn(),
  findByIdMock: vi.fn(),
  generationMatchesMock: vi.fn(),
}));

vi.mock("@nojv/redis", () => ({
  getRedis: () => ({
    eval: evalMock,
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
    twoFactorChangeGrant: (sessionId: string) => `nojv:2fa:change-grant:${sessionId}`,
  },
}));

vi.mock("@nojv/db", () => ({
  userRepo: {
    update: updateMock,
    findById: findByIdMock,
    securityGenerationMatches: generationMatchesMock,
  },
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
  evalMock
    .mockReset()
    .mockImplementation(
      async (
        _script: string,
        numberOfKeys: number,
        otpKey: string,
        attemptsKey: string,
        candidate: string,
        ttl: string,
        maxAttempts: string,
      ) => {
        if (numberOfKeys !== 2 || ttl !== "600" || maxAttempts !== "5") {
          throw new Error("Unexpected activation OTP EVAL contract");
        }
        const stored = store.get(otpKey);
        if (stored === undefined) return 0;
        if (stored === candidate) {
          store.delete(otpKey);
          store.delete(attemptsKey);
          return 1;
        }
        const attempts = (Number(store.get(attemptsKey)) || 0) + 1;
        store.set(attemptsKey, String(attempts));
        if (attempts >= 5) {
          store.delete(otpKey);
          store.delete(attemptsKey);
          return 3;
        }
        return 2;
      },
    );
  updateMock.mockReset().mockResolvedValue({ id: "usr_1", securityGeneration: 7 });
  findByIdMock.mockReset();
  generationMatchesMock.mockReset().mockResolvedValue(true);
});

describe("activation OTP — generation", () => {
  it("produces a zero-padded 6-digit code", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateActivationOtp()).toMatch(/^\d{6}$/);
    }
  });
});

describe("activation OTP — verification", () => {
  it("uses one atomic Redis script for compare, consume, attempts, and lockout", async () => {
    await storeActivationOtp("usr_1", "123456");

    await verifyActivationOtp("usr_1", "000000");

    expect(evalMock).toHaveBeenCalledOnce();
    const [script, numberOfKeys, otpKey, attemptsKey, candidate, ttl, maxAttempts] =
      evalMock.mock.calls[0]!;
    expect(numberOfKeys).toBe(2);
    expect(otpKey).toBe("nojv:2fa:activation-otp:usr_1");
    expect(attemptsKey).toBe("nojv:2fa:activation-otp-attempts:usr_1");
    expect(candidate).not.toBe("000000");
    expect(ttl).toBe("600");
    expect(maxAttempts).toBe("5");
    expect(script).toContain('redis.call("GET", KEYS[1])');
    expect(script).toContain('redis.call("INCR", KEYS[2])');
    expect(script).toContain('redis.call("EXPIRE", KEYS[2], tonumber(ARGV[2]))');
    expect(script).toContain('redis.call("DEL", KEYS[1], KEYS[2])');
    expect(script).not.toMatch(/GETDEL/i);
  });

  it("accepts the stored code once, then reports expired (single-use)", async () => {
    await storeActivationOtp("usr_1", "123456");
    expect(await verifyActivationOtp("usr_1", "123456")).toEqual({ ok: true });
    expect(await verifyActivationOtp("usr_1", "123456")).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("allows exactly one concurrent verifier in the Redis EVAL contract", async () => {
    await storeActivationOtp("usr_1", "123456");

    const results = await Promise.all([
      verifyActivationOtp("usr_1", "123456"),
      verifyActivationOtp("usr_1", "123456"),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: "expired" }]);
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
    await expect(setTwoFactorActivated("usr_1", true)).resolves.toEqual({
      userId: "usr_1",
      securityGeneration: 7,
    });
    expect(updateMock).toHaveBeenCalledWith("usr_1", { twoFactorActivated: true });
  });
});

describe("2FA change grant", () => {
  it("binds the grant to only the activating session", async () => {
    const proof = { userId: "usr_1", securityGeneration: 7 };
    expect(await hasTwoFactorChangeGrant("sess_1", proof)).toBe(false);
    await expect(markTwoFactorChangeGrant("sess_1", proof)).resolves.toBe(true);
    expect(await hasTwoFactorChangeGrant("sess_1", proof)).toBe(true);
    expect(await hasTwoFactorChangeGrant("sess_2", proof)).toBe(false);
    await clearTwoFactorChangeGrant("sess_1");
    expect(await hasTwoFactorChangeGrant("sess_1", proof)).toBe(false);
  });

  it("does not issue a grant after the captured generation becomes stale", async () => {
    const proof = { userId: "usr_1", securityGeneration: 7 };
    generationMatchesMock.mockResolvedValue(false);

    await expect(markTwoFactorChangeGrant("sess_1", proof)).resolves.toBe(false);
    expect(store.has("nojv:2fa:change-grant:sess_1")).toBe(false);
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
