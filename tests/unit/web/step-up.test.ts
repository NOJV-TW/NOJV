import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, setMock, verifyTotpMock, verifyBackupCodeMock } = vi.hoisted(() => {
  const map = new Map<string, string>();
  return {
    store: {
      map,
      reset() {
        map.clear();
      },
    },
    setMock: vi.fn(),
    verifyTotpMock: vi.fn(),
    verifyBackupCodeMock: vi.fn(),
  };
});

vi.mock("@nojv/redis", () => ({
  getRedis: () => ({
    set(key: string, value: string, _mode?: string, _ttl?: number) {
      setMock(key, value, _mode, _ttl);
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
    getdel(key: string) {
      const value = store.map.get(key) ?? null;
      store.map.delete(key);
      return Promise.resolve(value);
    },
  }),
  keys: {
    apiTokenStepUp: (sessionId: string) => `nojv:apitoken:stepup:${sessionId}`,
    stepUpHandoffTicket: (ticket: string) => `nojv:stepup:handoff:${ticket}`,
    twoFactorTotpSeen: (userId: string, code: string) => `nojv:2fa:totp-seen:${userId}:${code}`,
  },
}));

vi.mock("@nojv/db", () => new Proxy({}, { get: () => ({}) }));

vi.mock("$lib/auth.server", () => ({
  getAuth: () => ({
    api: { verifyTOTP: verifyTotpMock, verifyBackupCode: verifyBackupCodeMock },
  }),
}));

import {
  clearStepUp,
  hasFreshStepUp,
  isBackupCodeFormat,
  markStepUpFresh,
  markTotpSeen,
  validateStepUpCode,
  verifyBackupCodeStepUp,
  verifyStepUpCode,
  verifyTotpStepUp,
  wasTotpSeen,
} from "$lib/server/step-up";
import { consumeStepUpHandoffTicket, createStepUpHandoffTicket } from "@nojv/application";

beforeEach(() => {
  store.reset();
  setMock.mockReset();
  verifyTotpMock.mockReset();
  verifyBackupCodeMock.mockReset();
});

describe("step-up — code validation", () => {
  it("accepts exactly 6 digits", () => {
    expect(validateStepUpCode("123456")).toBe(true);
  });

  it("rejects codes with the wrong length", () => {
    expect(validateStepUpCode("12345")).toBe(false);
    expect(validateStepUpCode("1234567")).toBe(false);
    expect(validateStepUpCode("")).toBe(false);
  });

  it("rejects non-digit codes", () => {
    expect(validateStepUpCode("12345a")).toBe(false);
    expect(validateStepUpCode(" 12345")).toBe(false);
    expect(validateStepUpCode("12 456")).toBe(false);
  });
});

describe("step-up — backup code format", () => {
  it("accepts a 5-5 alphanumeric backup code", () => {
    expect(isBackupCodeFormat("abc12-XY34z")).toBe(true);
    expect(isBackupCodeFormat("00000-00000")).toBe(true);
  });

  it("rejects a 6-digit TOTP code", () => {
    expect(isBackupCodeFormat("123456")).toBe(false);
  });

  it("rejects malformed backup codes", () => {
    expect(isBackupCodeFormat("abc1-XY34z")).toBe(false);
    expect(isBackupCodeFormat("abc12XY34z")).toBe(false);
    expect(isBackupCodeFormat("abc12-XY34")).toBe(false);
    expect(isBackupCodeFormat("abc1_-XY34z")).toBe(false);
  });
});

describe("step-up — sudo marker", () => {
  it("binds a fresh marker to exactly one session", async () => {
    expect(await hasFreshStepUp("sess_1")).toBe(false);

    await markStepUpFresh("sess_1");
    expect(await hasFreshStepUp("sess_1")).toBe(true);
    expect(await hasFreshStepUp("sess_2")).toBe(false);

    await clearStepUp("sess_1");
    expect(await hasFreshStepUp("sess_1")).toBe(false);
  });
});

describe("step-up — session-rotation handoff ticket", () => {
  it("is random, short-lived, and consumable exactly once", async () => {
    const ticket = await createStepUpHandoffTicket("usr_1");

    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(setMock).toHaveBeenCalledWith(`nojv:stepup:handoff:${ticket}`, "usr_1", "EX", 60);
    await expect(consumeStepUpHandoffTicket(ticket)).resolves.toBe("usr_1");
    await expect(consumeStepUpHandoffTicket(ticket)).resolves.toBeNull();
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

describe("step-up — backup code verification", () => {
  it("returns true when verifyBackupCode resolves", async () => {
    verifyBackupCodeMock.mockResolvedValue({ status: true });
    const headers = new Headers();
    expect(await verifyBackupCodeStepUp("abc12-XY34z", headers)).toBe(true);
    expect(verifyBackupCodeMock).toHaveBeenCalledWith({
      body: { code: "abc12-XY34z" },
      headers,
    });
  });

  it("returns false when verifyBackupCode throws", async () => {
    verifyBackupCodeMock.mockRejectedValue(new Error("invalid backup code"));
    expect(await verifyBackupCodeStepUp("abc12-XY34z", new Headers())).toBe(false);
  });
});

describe("step-up — verifyStepUpCode", () => {
  it("rejects a malformed code", async () => {
    expect(await verifyStepUpCode("usr_1", "12ab", new Headers())).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("rejects a replayed TOTP code without re-verifying", async () => {
    await markTotpSeen("usr_1", "123456");
    expect(await verifyStepUpCode("usr_1", "123456", new Headers())).toEqual({
      ok: false,
      reason: "replayed",
    });
    expect(verifyTotpMock).not.toHaveBeenCalled();
  });

  it("accepts a fresh TOTP code and records it as seen", async () => {
    verifyTotpMock.mockResolvedValue({ status: true });
    expect(await verifyStepUpCode("usr_1", "123456", new Headers())).toEqual({ ok: true });
    expect(await wasTotpSeen("usr_1", "123456")).toBe(true);
  });

  it("rejects an invalid TOTP code", async () => {
    verifyTotpMock.mockRejectedValue(new Error("invalid"));
    expect(await verifyStepUpCode("usr_1", "000000", new Headers())).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("accepts a backup code without touching the replay key", async () => {
    verifyBackupCodeMock.mockResolvedValue({ status: true });
    expect(await verifyStepUpCode("usr_1", "abc12-XY34z", new Headers())).toEqual({ ok: true });
    expect(verifyTotpMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid backup code", async () => {
    verifyBackupCodeMock.mockRejectedValue(new Error("invalid"));
    expect(await verifyStepUpCode("usr_1", "abc12-XY34z", new Headers())).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});
