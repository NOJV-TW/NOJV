import { beforeEach, describe, expect, it, vi } from "vitest";

const { evalMock, factorStateMock, generationMatchesMock, store } = vi.hoisted(() => ({
  evalMock: vi.fn(),
  factorStateMock: vi.fn(),
  generationMatchesMock: vi.fn(),
  store: new Map<string, string>(),
}));

vi.mock("@nojv/redis", () => ({
  getRedis: () => ({
    eval: evalMock,
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    set: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve("OK");
    },
    del: (...keys: string[]) => {
      for (const key of keys) store.delete(key);
      return Promise.resolve(keys.length);
    },
  }),
  keys: {
    securitySettingsGrant: (sessionId: string) => `nojv:security:settings-grant:${sessionId}`,
    securitySetupOtp: (userId: string) => `nojv:security:setup-otp:${userId}`,
    securitySetupOtpAttempts: (userId: string) => `nojv:security:setup-otp-attempts:${userId}`,
  },
}));

vi.mock("@nojv/db", () => ({
  securityFactorRepo: { getState: factorStateMock },
  userRepo: { securityGenerationMatches: generationMatchesMock },
}));

import {
  areSecuritySettingsUnlocked,
  generateSecuritySetupOtp,
  getSecurityFactorState,
  passkeyRegistrationDenialReason,
  storeSecuritySetupOtp,
  unlockSecuritySettings,
  verifySecuritySetupOtp,
} from "@nojv/application";

beforeEach(() => {
  store.clear();
  generationMatchesMock.mockReset().mockResolvedValue(true);
  factorStateMock.mockReset();
  evalMock
    .mockReset()
    .mockImplementation(
      async (
        _script: string,
        numberOfKeys: number,
        otpKey: string,
        attemptsKey: string,
        candidate: string,
        _ttl: string,
        maxAttempts: string,
      ) => {
        if (numberOfKeys !== 2) throw new Error("Unexpected Redis script");
        const stored = store.get(otpKey);
        if (!stored) return 0;
        if (stored === candidate) {
          store.delete(otpKey);
          store.delete(attemptsKey);
          return 1;
        }
        const attempts = (Number(store.get(attemptsKey)) || 0) + 1;
        store.set(attemptsKey, String(attempts));
        if (attempts >= Number(maxAttempts)) {
          store.delete(otpKey);
          store.delete(attemptsKey);
          return 3;
        }
        return 2;
      },
    );
});

describe("factor-derived security state", () => {
  it("uses verified factor presence as the only configured state", async () => {
    const state = {
      hasPasskey: true,
      hasSecurityFactor: true,
      hasTotp: false,
      isSuperAdmin: false,
      securityGeneration: 4,
    };
    factorStateMock.mockResolvedValue(state);
    await expect(getSecurityFactorState("usr_1")).resolves.toEqual(state);
  });

  it("allows passkey registration only inside the settings window", () => {
    expect(passkeyRegistrationDenialReason({ securitySettingsUnlocked: false })).toBe(
      "security_settings_locked",
    );
    expect(passkeyRegistrationDenialReason({ securitySettingsUnlocked: true })).toBeNull();
  });
});

describe("first-factor email OTP", () => {
  it("generates six digits and stores only a hash", async () => {
    expect(generateSecuritySetupOtp()).toMatch(/^\d{6}$/);
    await storeSecuritySetupOtp("usr_1", "123456");
    expect(store.get("nojv:security:setup-otp:usr_1")).not.toContain("123456");
  });

  it("is single-use and locks after five failures", async () => {
    await storeSecuritySetupOtp("usr_1", "123456");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(verifySecuritySetupOtp("usr_1", "000000")).resolves.toEqual({
        ok: false,
        reason: "invalid",
      });
    }
    await expect(verifySecuritySetupOtp("usr_1", "000000")).resolves.toEqual({
      ok: false,
      reason: "locked",
    });
    await expect(verifySecuritySetupOtp("usr_1", "123456")).resolves.toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("accepts the correct code once", async () => {
    await storeSecuritySetupOtp("usr_1", "123456");
    await expect(verifySecuritySetupOtp("usr_1", "123456")).resolves.toEqual({ ok: true });
    await expect(verifySecuritySetupOtp("usr_1", "123456")).resolves.toEqual({
      ok: false,
      reason: "expired",
    });
  });
});

describe("10-minute settings grant", () => {
  const proof = { userId: "usr_1", securityGeneration: 7 };

  it("binds the grant to the session and generation", async () => {
    await expect(unlockSecuritySettings("sess_1", proof)).resolves.toBe(true);
    await expect(areSecuritySettingsUnlocked("sess_1", proof)).resolves.toBe(true);
    await expect(areSecuritySettingsUnlocked("sess_2", proof)).resolves.toBe(false);
    await expect(
      areSecuritySettingsUnlocked("sess_1", { ...proof, securityGeneration: 8 }),
    ).resolves.toBe(false);
  });

  it("does not grant stale security state", async () => {
    generationMatchesMock.mockResolvedValue(false);
    await expect(unlockSecuritySettings("sess_1", proof)).resolves.toBe(false);
    expect(store.size).toBe(0);
  });
});
