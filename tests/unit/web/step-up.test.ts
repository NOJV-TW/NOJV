import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, verifyTotpMock } = vi.hoisted(() => {
  const map = new Map<string, string>();
  return {
    store: {
      map,
      reset() {
        map.clear();
      },
    },
    verifyTotpMock: vi.fn(),
  };
});

vi.mock("@nojv/redis", () => ({
  getRedis: () => ({
    set(key: string, value: string, _mode?: string, _ttl?: number) {
      store.map.set(key, value);
      return Promise.resolve("OK");
    },
    get(key: string) {
      return Promise.resolve(store.map.get(key) ?? null);
    },
    del(...keys: string[]) {
      let count = 0;
      for (const key of keys) {
        if (store.map.delete(key)) count += 1;
      }
      return Promise.resolve(count);
    },
  }),
  keys: {
    apiTokenStepUp: (userId: string) => `nojv:apitoken:stepup:${userId}`,
    twoFactorEnrollOtp: (userId: string) => `nojv:2fa:enroll-otp:${userId}`,
    twoFactorTotpSeen: (userId: string, code: string) => `nojv:2fa:totp-seen:${userId}:${code}`,
  },
}));

vi.mock("@nojv/db", () => new Proxy({}, { get: () => ({}) }));

vi.mock("$lib/auth.server", () => ({
  getAuth: () => ({ api: { verifyTOTP: verifyTotpMock } }),
}));

import {
  OTP_LENGTH,
  clearStepUp,
  generateOtp,
  hasFreshStepUp,
  markStepUpFresh,
  markTotpSeen,
  storeEnrollOtp,
  verifyEnrollOtp,
  verifyTotpStepUp,
  wasTotpSeen,
} from "$lib/server/step-up";

beforeEach(() => {
  store.reset();
  verifyTotpMock.mockReset();
});

describe("step-up — enroll OTP", () => {
  it("generates an OTP of OTP_LENGTH digits", () => {
    for (let i = 0; i < 50; i += 1) {
      const otp = generateOtp();
      expect(otp).toMatch(new RegExp(`^\\d{${OTP_LENGTH}}$`));
    }
  });

  it("stores then verifies a correct OTP and consumes it single-use", async () => {
    await storeEnrollOtp("usr_1", "123456");

    expect(await verifyEnrollOtp("usr_1", "123456")).toBe(true);
    expect(await verifyEnrollOtp("usr_1", "123456")).toBe(false);
  });

  it("does not persist the OTP in plaintext", async () => {
    await storeEnrollOtp("usr_1", "123456");
    expect([...store.map.values()]).not.toContain("123456");
  });

  it("rejects a wrong OTP", async () => {
    await storeEnrollOtp("usr_1", "123456");
    expect(await verifyEnrollOtp("usr_1", "000000")).toBe(false);
  });

  it("rejects when no OTP was stored", async () => {
    expect(await verifyEnrollOtp("usr_nope", "123456")).toBe(false);
  });
});

describe("step-up — sudo marker", () => {
  it("sets, observes, and clears the fresh marker", async () => {
    expect(await hasFreshStepUp("usr_1")).toBe(false);

    await markStepUpFresh("usr_1");
    expect(await hasFreshStepUp("usr_1")).toBe(true);

    await clearStepUp("usr_1");
    expect(await hasFreshStepUp("usr_1")).toBe(false);
  });
});

describe("step-up — TOTP replay dedupe", () => {
  it("records and observes a seen TOTP code", async () => {
    expect(await wasTotpSeen("usr_1", "111222")).toBe(false);
    await markTotpSeen("usr_1", "111222");
    expect(await wasTotpSeen("usr_1", "111222")).toBe(true);
    expect(await wasTotpSeen("usr_1", "999888")).toBe(false);
  });
});

describe("step-up — TOTP verification", () => {
  it("returns true when verifyTOTP resolves", async () => {
    verifyTotpMock.mockResolvedValue({ status: true });
    const headers = new Headers();
    expect(await verifyTotpStepUp("123456", headers)).toBe(true);
    expect(verifyTotpMock).toHaveBeenCalledWith({ body: { code: "123456" }, headers });
  });

  it("returns false when verifyTOTP throws", async () => {
    verifyTotpMock.mockRejectedValue(new Error("invalid code"));
    expect(await verifyTotpStepUp("000000", new Headers())).toBe(false);
  });
});
