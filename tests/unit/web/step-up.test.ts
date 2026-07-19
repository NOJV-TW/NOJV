import { beforeEach, describe, expect, it, vi } from "vitest";

const { generationMatchesMock, store, verifyTotpMock } = vi.hoisted(() => ({
  generationMatchesMock: vi.fn(),
  store: new Map<string, string>(),
  verifyTotpMock: vi.fn(),
}));

vi.mock("@nojv/redis", () => ({
  getRedis: () => ({
    set(key: string, value: string, ...options: Array<string | number>) {
      if (options.includes("NX") && store.has(key)) return Promise.resolve(null);
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
    eval(script: string, keyCount: number, ...args: Array<string | number>) {
      const keys = args.slice(0, keyCount).map(String);
      const argv = args.slice(keyCount).map(String);
      if (script.includes('redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])')) {
        store.set(keys[0]!, argv[0]!);
        store.set(keys[1]!, argv[0]!);
        if (argv[3] === "1") store.set(keys[2]!, argv[0]!);
        return Promise.resolve(1);
      }
      if (script.includes('redis.call("SET", KEYS[3], ARGV[1], "EX", ARGV[2])')) {
        if (store.get(keys[0]!) !== argv[0] || store.get(keys[1]!) !== argv[0]) {
          return Promise.resolve(0);
        }
        store.set(keys[2]!, argv[0]!);
        return Promise.resolve(1);
      }
      if (script.includes("local mode = redis.call")) {
        if (store.get(keys[1]!) === argv[0] && store.get(keys[0]!) === argv[0]) {
          return Promise.resolve(1);
        }
        store.delete(keys[0]!);
        store.delete(keys[1]!);
        return Promise.resolve(0);
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
  consumeTotpCode,
  grantAdminElevation,
  hasAdminSessionMfa,
  hasFreshStepUp,
  hasTokenPageMfa,
  markVerifiedSession,
  resolveAdminElevation,
  revokeAdminElevation,
  securityGenerationMarker,
  validateStepUpCode,
  verifyStepUpCode,
  verifyTotpStepUp,
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
    await expect(verifyStepUpCode(proof, "abc12-XY34z", new Headers(), true)).resolves.toEqual({
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

describe("admin elevation", () => {
  const admin = {
    ...proof,
    disabled: false,
    platformRole: "admin" as const,
    twoFactorActivated: true,
  };

  it("requires two-factor activation for every admin", async () => {
    await expect(
      grantAdminElevation("sess_1", { ...admin, twoFactorActivated: false }),
    ).resolves.toBe(false);
  });

  it("requires a fresh two-factor marker before every elevation", async () => {
    await expect(grantAdminElevation("sess_1", admin)).resolves.toBe(false);
    await expect(resolveAdminElevation("sess_1", admin)).resolves.toBe(false);
  });

  it("grants and resolves admin mode after verified two-factor step-up", async () => {
    await markVerifiedSession("sess_1", proof, true);

    await expect(grantAdminElevation("sess_1", admin)).resolves.toBe(true);
    await expect(resolveAdminElevation("sess_1", admin)).resolves.toBe(true);
  });

  it("requires another two-factor step-up after switching admin mode off", async () => {
    await markVerifiedSession("sess_1", proof, true);
    await expect(grantAdminElevation("sess_1", admin)).resolves.toBe(true);

    await revokeAdminElevation("sess_1");

    await expect(grantAdminElevation("sess_1", admin)).resolves.toBe(false);
    await expect(resolveAdminElevation("sess_1", admin)).resolves.toBe(false);
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
  it("does not invoke Better Auth when the current session has no verified TOTP factor", async () => {
    verifyTotpMock.mockResolvedValue({ status: true });

    await expect(verifyStepUpCode(proof, "123456", new Headers(), false)).resolves.toEqual({
      ok: false,
      reason: "factor_unavailable",
    });
    expect(verifyTotpMock).not.toHaveBeenCalled();
  });

  it("delegates a valid TOTP assertion to Better Auth", async () => {
    verifyTotpMock.mockResolvedValue({ status: true });
    const headers = new Headers();

    await expect(verifyTotpStepUp("123456", headers)).resolves.toBe(true);
    expect(verifyTotpMock).toHaveBeenCalledWith({ body: { code: "123456" }, headers });
  });

  it("rejects a replay after cryptographic verification", async () => {
    store.set("nojv:2fa:totp-seen:usr_1:123456", "1");
    verifyTotpMock.mockResolvedValue({ status: true });

    await expect(verifyStepUpCode(proof, "123456", new Headers(), true)).resolves.toEqual({
      ok: false,
      reason: "replayed",
    });
    expect(verifyTotpMock).toHaveBeenCalledOnce();
  });

  it("accepts a fresh current proof and records the TOTP as seen", async () => {
    verifyTotpMock.mockResolvedValue({ status: true });

    await expect(verifyStepUpCode(proof, "123456", new Headers(), true)).resolves.toEqual({
      ok: true,
    });
    expect(store.get("nojv:2fa:totp-seen:usr_1:123456")).toBe("1");
  });

  it("allows exactly one of two concurrent requests to consume the same valid TOTP", async () => {
    verifyTotpMock.mockResolvedValue({ status: true });

    const results = await Promise.all([
      verifyStepUpCode(proof, "123456", new Headers(), true),
      verifyStepUpCode(proof, "123456", new Headers(), true),
    ]);

    expect(results).toEqual(
      expect.arrayContaining([{ ok: true }, { ok: false, reason: "replayed" }]),
    );
  });

  it("consumes the TOTP but rejects a proof invalidated during verification", async () => {
    verifyTotpMock.mockResolvedValue({ status: true });
    generationMatchesMock.mockResolvedValue(false);

    await expect(verifyStepUpCode(proof, "123456", new Headers(), true)).resolves.toEqual({
      ok: false,
      reason: "stale",
    });
    expect(store.get("nojv:2fa:totp-seen:usr_1:123456")).toBe("1");
  });

  it("rejects an invalid TOTP", async () => {
    verifyTotpMock.mockRejectedValue(new Error("invalid"));

    await expect(verifyStepUpCode(proof, "000000", new Headers(), true)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("atomically consumes a code only once", async () => {
    await expect(consumeTotpCode(proof.userId, "654321")).resolves.toBe(true);
    await expect(consumeTotpCode(proof.userId, "654321")).resolves.toBe(false);
  });
});
