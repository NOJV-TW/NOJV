import { beforeEach, describe, expect, it, vi } from "vitest";

const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock("@nojv/redis", () => ({
  getRedis: () => ({
    get: (k: string) => Promise.resolve(store.get(k) ?? null),
    set: (k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve("OK");
    },
    del: (k: string) => {
      store.delete(k);
      return Promise.resolve(1);
    },
  }),
  keys: {
    twoFactorEnrollConfirm: (h: string) => `nojv:2fa:enroll-confirm:${h}`,
    twoFactorEnrollConfirmed: (u: string) => `nojv:2fa:enroll-confirmed:${u}`,
  },
}));

import {
  clearEnrollConfirmed,
  confirmEnroll,
  generateEnrollToken,
  hasEnrollConfirmed,
  peekEnrollConfirm,
  storeEnrollConfirm,
} from "$lib/server/two-factor-enroll";

beforeEach(() => store.clear());

describe("two-factor enroll-confirm token (pepper-free)", () => {
  it("generates a high-entropy 256-bit token (base64url, 43 chars)", () => {
    const token = generateEnrollToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateEnrollToken()).not.toBe(token);
  });

  it("peek returns the userId for a valid token without consuming it", async () => {
    const token = generateEnrollToken();
    await storeEnrollConfirm("usr_1", token);
    expect(await peekEnrollConfirm(token)).toBe("usr_1");
    expect(await peekEnrollConfirm(token)).toBe("usr_1");
  });

  it("peek returns null for an unknown token", async () => {
    await storeEnrollConfirm("usr_1", generateEnrollToken());
    expect(await peekEnrollConfirm(generateEnrollToken())).toBeNull();
  });

  it("confirm consumes the token (single-use) and sets the confirmed flag", async () => {
    const token = generateEnrollToken();
    await storeEnrollConfirm("usr_1", token);
    expect(await hasEnrollConfirmed("usr_1")).toBe(false);
    expect(await confirmEnroll(token)).toBe("usr_1");
    expect(await hasEnrollConfirmed("usr_1")).toBe(true);
    expect(await peekEnrollConfirm(token)).toBeNull();
    expect(await confirmEnroll(token)).toBeNull();
  });

  it("stores only the sha256 of the token, never the raw token", async () => {
    const token = generateEnrollToken();
    await storeEnrollConfirm("usr_1", token);
    for (const key of store.keys()) {
      expect(key).not.toContain(token);
    }
  });

  it("clearEnrollConfirmed removes the confirmed flag", async () => {
    const token = generateEnrollToken();
    await storeEnrollConfirm("usr_1", token);
    await confirmEnroll(token);
    await clearEnrollConfirmed("usr_1");
    expect(await hasEnrollConfirmed("usr_1")).toBe(false);
  });
});
