import { beforeEach, describe, expect, it, vi } from "vitest";

const { generationMatchesMock, store, verifyTotpMock } = vi.hoisted(() => ({
  generationMatchesMock: vi.fn(),
  store: new Map<string, string>(),
  verifyTotpMock: vi.fn(),
}));

vi.mock("@nojv/redis", () => ({
  getRedis: () => ({
    set(key: string, value: string) {
      store.set(key, value);
      return Promise.resolve("OK");
    },
    get(key: string) {
      return Promise.resolve(store.get(key) ?? null);
    },
    del(...keys: string[]) {
      let count = 0;
      for (const key of keys) {
        if (store.delete(key)) count += 1;
      }
      return Promise.resolve(count);
    },
    getdel(key: string) {
      const value = store.get(key) ?? null;
      store.delete(key);
      return Promise.resolve(value);
    },
    eval(_script: string, keyCount: number, ...args: Array<string | number>) {
      const keys = args.slice(0, keyCount).map(String);
      const argv = args.slice(keyCount).map(String);
      if (keyCount === 3 && argv.length === 5) {
        store.set(keys[0]!, argv[0]!);
        store.set(keys[1]!, argv[0]!);
        if (argv[3] === "1") store.set(keys[2]!, argv[0]!);
        return Promise.resolve(1);
      }
      throw new Error("Unexpected Redis script in step-up unit test");
    },
  }),
  keys: {
    apiTokenStepUp: (sessionId: string) => `nojv:apitoken:stepup:${sessionId}`,
    tokenPageMfa: (sessionId: string) => `nojv:apitoken:page-mfa:${sessionId}`,
    adminSessionMfa: (sessionId: string) => `nojv:admin:mfa:${sessionId}`,
    adminMode: (sessionId: string) => `nojv:admin:mode:${sessionId}`,
    stepUpHandoffTicket: (ticket: string) => `nojv:stepup:handoff:${ticket}`,
    twoFactorTotpSeen: (userId: string, code: string) => `nojv:2fa:totp-seen:${userId}:${code}`,
  },
}));

vi.mock("@nojv/db", () => ({
  accountRepo: { hasCredentialPassword: vi.fn() },
  userRepo: { securityGenerationMatches: generationMatchesMock },
}));

vi.mock("$lib/auth.server", () => ({
  getAuth: () => ({ api: { verifyTOTP: verifyTotpMock } }),
}));

import {
  clearStepUp,
  hasAdminSessionMfa,
  hasFreshStepUp,
  hasTokenPageMfa,
  markTotpSeen,
  markVerifiedSession,
  securityGenerationMarker,
  validateStepUpCode,
  verifyStepUpCode,
  verifyTotpStepUp,
  wasTotpSeen,
} from "$lib/server/step-up";
import { consumeStepUpHandoffTicket, createStepUpHandoffTicket } from "@nojv/application";

const proof = { userId: "usr_1", securityGeneration: 7 };
const marker = "sg1:usr_1:7";

beforeEach(() => {
  store.clear();
  generationMatchesMock.mockReset().mockResolvedValue(true);
  verifyTotpMock.mockReset();
});

describe("step-up code validation", () => {
  it("accepts exactly six digits", () => {
    expect(validateStepUpCode("123456")).toBe(true);
    expect(validateStepUpCode("12345")).toBe(false);
    expect(validateStepUpCode("1234567")).toBe(false);
    expect(validateStepUpCode("12345a")).toBe(false);
    expect(validateStepUpCode(" 12345")).toBe(false);
  });

  it("does not accept recovery codes for privileged step-up", async () => {
    await expect(verifyStepUpCode(proof, "abc12-XY34z", new Headers())).resolves.toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(verifyTotpMock).not.toHaveBeenCalled();
    expect(generationMatchesMock).not.toHaveBeenCalled();
  });
});

describe("durable security-generation markers", () => {
  it("uses a namespaced marker that cannot collide with legacy formats", () => {
    expect(securityGenerationMarker(proof)).toBe(marker);
    expect(marker).not.toBe("usr_1");
    expect(marker).not.toBe("usr_1:7");
  });

  it("marks only a still-current session proof", async () => {
    await expect(markVerifiedSession("sess_1", proof, true)).resolves.toBe(true);
    await expect(hasFreshStepUp("sess_1", proof)).resolves.toBe(true);
    await expect(hasTokenPageMfa("sess_1", proof)).resolves.toBe(true);
    await expect(hasAdminSessionMfa("sess_1", proof)).resolves.toBe(true);
    await expect(hasFreshStepUp("sess_2", proof)).resolves.toBe(false);

    await clearStepUp("sess_1");
    await expect(hasFreshStepUp("sess_1", proof)).resolves.toBe(false);
  });

  it("does not write when the captured generation is stale", async () => {
    generationMatchesMock.mockResolvedValue(false);

    await expect(markVerifiedSession("sess_1", proof, true)).resolves.toBe(false);
    expect(store.size).toBe(0);
  });
});

describe("session-rotation handoff ticket", () => {
  it("stores the exact proof and consumes it once", async () => {
    const ticket = await createStepUpHandoffTicket(proof);

    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.get(`nojv:stepup:handoff:${ticket}`)).toBe(JSON.stringify(proof));
    await expect(consumeStepUpHandoffTicket(ticket)).resolves.toEqual(proof);
    await expect(consumeStepUpHandoffTicket(ticket)).resolves.toBeNull();
  });

  it("fails closed for legacy uid-only and uid-generation tickets", async () => {
    store.set("nojv:stepup:handoff:legacy-uid", proof.userId);
    store.set("nojv:stepup:handoff:legacy-epoch", `${proof.userId}:7`);

    await expect(consumeStepUpHandoffTicket("legacy-uid")).resolves.toBeNull();
    await expect(consumeStepUpHandoffTicket("legacy-epoch")).resolves.toBeNull();
  });
});

describe("TOTP verification", () => {
  it("delegates a valid TOTP assertion to Better Auth", async () => {
    verifyTotpMock.mockResolvedValue({ status: true });
    const headers = new Headers();

    await expect(verifyTotpStepUp("123456", headers)).resolves.toBe(true);
    expect(verifyTotpMock).toHaveBeenCalledWith({ body: { code: "123456" }, headers });
  });

  it("rejects a replay without re-verifying", async () => {
    await markTotpSeen(proof.userId, "123456");

    await expect(verifyStepUpCode(proof, "123456", new Headers())).resolves.toEqual({
      ok: false,
      reason: "replayed",
    });
    expect(verifyTotpMock).not.toHaveBeenCalled();
  });

  it("accepts a fresh current proof and records the TOTP as seen", async () => {
    verifyTotpMock.mockResolvedValue({ status: true });

    await expect(verifyStepUpCode(proof, "123456", new Headers())).resolves.toEqual({
      ok: true,
    });
    await expect(wasTotpSeen(proof.userId, "123456")).resolves.toBe(true);
  });

  it("consumes the TOTP but rejects a proof invalidated during verification", async () => {
    verifyTotpMock.mockResolvedValue({ status: true });
    generationMatchesMock.mockResolvedValue(false);

    await expect(verifyStepUpCode(proof, "123456", new Headers())).resolves.toEqual({
      ok: false,
      reason: "stale",
    });
    await expect(wasTotpSeen(proof.userId, "123456")).resolves.toBe(true);
  });

  it("rejects an invalid TOTP", async () => {
    verifyTotpMock.mockRejectedValue(new Error("invalid"));

    await expect(verifyStepUpCode(proof, "000000", new Headers())).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});
