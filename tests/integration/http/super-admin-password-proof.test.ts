import type { Cookies } from "@sveltejs/kit";
import { describe, expect, it, vi } from "vitest";

import {
  consumeSuperAdminPasswordProof,
  isSuperAdminPasswordProofSessionValid,
  issueSuperAdminPasswordProof,
  readSuperAdminPasswordProof,
  SUPER_ADMIN_PASSWORD_PROOF_COOKIE,
} from "$lib/server/super-admin-password-proof";
import { createTestUser, testPrisma } from "../../fixtures/factories";

function cookieJar() {
  const values = new Map<string, string>();
  return {
    cookies: {
      delete: vi.fn((name: string) => values.delete(name)),
      get: (name: string) => values.get(name),
      getAll: vi.fn(),
      serialize: vi.fn(),
      set: vi.fn((name: string, value: string) => values.set(name, value)),
    } as unknown as Cookies,
    values,
  };
}

describe("super admin password-first proof", () => {
  it("accepts pre-session proofs but binds session proofs to the session that created them", () => {
    const proof = {
      authenticatedAt: "2026-09-04T00:00:00.000Z",
      securityGeneration: 1,
      sessionId: "session-1",
      userId: "user-1",
    };
    expect(isSuperAdminPasswordProofSessionValid(proof, "session-1")).toBe(true);
    expect(isSuperAdminPasswordProofSessionValid(proof, "session-2")).toBe(false);
    expect(isSuperAdminPasswordProofSessionValid({ ...proof, sessionId: null }, null)).toBe(
      true,
    );
  });

  it("is generation-bound and can be consumed only once", async () => {
    const user = await createTestUser({ isSuperAdmin: true, platformRole: "admin" });
    const { cookies, values } = cookieJar();
    const proof = {
      authenticatedAt: "2026-09-04T00:00:00.000Z",
      securityGeneration: user.securityGeneration,
      sessionId: null,
      userId: user.id,
    };
    await issueSuperAdminPasswordProof(cookies, proof);
    const ticket = values.get(SUPER_ADMIN_PASSWORD_PROOF_COOKIE)!;
    await expect(readSuperAdminPasswordProof(ticket)).resolves.toEqual(proof);
    await expect(consumeSuperAdminPasswordProof(ticket, user.id)).resolves.toEqual(proof);
    await expect(consumeSuperAdminPasswordProof(ticket, user.id)).resolves.toBeNull();

    await issueSuperAdminPasswordProof(cookies, proof);
    const staleTicket = values.get(SUPER_ADMIN_PASSWORD_PROOF_COOKIE)!;
    await testPrisma.user.update({ where: { id: user.id }, data: { disabled: true } });
    await expect(readSuperAdminPasswordProof(staleTicket)).resolves.toBeNull();
    await expect(consumeSuperAdminPasswordProof(staleTicket, user.id)).resolves.toBeNull();
  });
});
