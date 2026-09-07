import {
  getRequestStateAsyncLocalStorage,
  runWithRequestState,
} from "@better-auth/core/context";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  areUnlockedMock,
  createTicketMock,
  deletePasskeysMock,
  findPasskeyMock,
  findUserMock,
  markFactorChangeMock,
  passkeyRecords,
  registrationDenialMock,
  userRepoMock,
} = vi.hoisted(() => ({
  areUnlockedMock: vi.fn(),
  createTicketMock: vi.fn(),
  deletePasskeysMock: vi.fn(),
  findPasskeyMock: vi.fn(),
  findUserMock: vi.fn(),
  markFactorChangeMock: vi.fn(),
  passkeyRecords: new Map<
    string,
    { isSuperAdmin?: boolean; userId: string; securityGeneration: number }
  >(),
  registrationDenialMock: vi.fn(),
  userRepoMock: {
    findByUsername: vi.fn(),
    attachPlaceholderToAuth: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("better-auth/adapters/prisma", () => ({ prismaAdapter: () => ({}) }));

vi.mock("better-auth/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("better-auth/api")>()),
  createAuthMiddleware: (handler: unknown) => handler,
}));

vi.mock("better-auth/plugins", () => ({
  twoFactor: () => ({ id: "two-factor" }),
  username: () => ({ id: "username" }),
}));

vi.mock("@nojv/application", () => ({
  adminMfaKind: (user: { isSuperAdmin: boolean; platformRole: string }) =>
    user.platformRole !== "admin" ? "none" : user.isSuperAdmin ? "super" : "regular",
  areSecuritySettingsUnlocked: areUnlockedMock,
  createStepUpHandoffTicket: createTicketMock,
  hasAdminSessionMfa: vi.fn(),
  hasFreshStepUp: vi.fn(),
  isSuperAdminSessionExpired: vi.fn(),
  markFactorChangeVerifiedSession: markFactorChangeMock,
  markVerifiedSession: vi.fn(),
  passkeyRegistrationDenialReason: registrationDenialMock,
  securityGenerationProof: (user: { id: string; securityGeneration: number }) => ({
    userId: user.id,
    securityGeneration: user.securityGeneration,
  }),
}));

vi.mock("$lib/server/super-admin-password-proof", () => ({
  consumeSuperAdminPasswordProof: vi.fn(),
  isSuperAdminPasswordProofSessionValid: vi.fn(
    (proof: { sessionId: string | null }, sessionId: string | null) =>
      proof.sessionId === null || proof.sessionId === sessionId,
  ),
  passwordProofTicketFromCookieHeader: vi.fn(() => null),
  readSuperAdminPasswordProof: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  prismaAdapterClient: {
    passkey: { deleteMany: deletePasskeysMock, findFirst: findPasskeyMock },
    user: { findUnique: findUserMock },
  },
  userRepo: userRepoMock,
}));

vi.mock("$lib/server/env", () => ({
  getWebEnv: () => ({
    BETTER_AUTH_SECRET: "test-secret-at-least-32-characters",
    BETTER_AUTH_URL: "https://nojv.test",
    NODE_ENV: "test",
  }),
}));

vi.mock("$lib/server/logger", () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn() }),
}));

import { getAuth } from "$lib/auth.server";
import { getPasskeyRegistrationProof } from "$lib/server/passkey-request-proof";
import {
  consumeInternalFactorMutationAuthority,
  factorMutationPath,
  runInternalFactorMutation,
} from "$lib/server/auth-factor-mutation";

interface PasskeyHookContext {
  body: { response: { id: string } } | Record<string, never>;
  context?: {
    session?: {
      session: { id: string };
      user: {
        id: string;
        isSuperAdmin: boolean;
        platformRole: string;
        securityGeneration: number;
      };
    };
  };
  headers?: Headers;
  path: string;
}

interface PasskeyAfterVerificationInput {
  clientData: { id: string };
  ctx: { setCookie: ReturnType<typeof vi.fn> };
}

interface CapturedAuthOptions {
  databaseHooks: {
    account: {
      create: { before: (account: { providerId: string; userId: string }) => Promise<void> };
    };
  };
  hooks: {
    after: (ctx: Pick<PasskeyHookContext, "path">) => Promise<void>;
    before: (ctx: PasskeyHookContext) => Promise<void>;
  };
  plugins: Array<{
    id: string;
    options?: {
      authentication?: {
        afterVerification?: (input: PasskeyAfterVerificationInput) => Promise<void>;
      };
    };
  }>;
}

function productionPasskeyCallbacks() {
  const options = (getAuth() as unknown as { options: CapturedAuthOptions }).options;
  const plugin = options.plugins.find(({ id }) => id === "passkey");
  const afterVerification = plugin?.options?.authentication?.afterVerification;
  if (!afterVerification) throw new Error("Production passkey callback was not wired");
  return { after: options.hooks.after, before: options.hooks.before, afterVerification };
}

beforeAll(async () => {
  await getRequestStateAsyncLocalStorage();
});

beforeEach(() => {
  passkeyRecords.clear();
  areUnlockedMock.mockReset().mockResolvedValue(true);
  createTicketMock
    .mockReset()
    .mockImplementation(
      async (proof: { userId: string; securityGeneration: number }) =>
        `ticket:${proof.userId}:${String(proof.securityGeneration)}`,
    );
  findPasskeyMock
    .mockReset()
    .mockImplementation(
      async (query: {
        where: { credentialID: string };
        select: { user?: unknown; userId?: unknown };
      }) => {
        const record = passkeyRecords.get(query.where.credentialID);
        if (!record) return null;
        return query.select.user
          ? {
              user: {
                id: record.userId,
                isSuperAdmin: record.isSuperAdmin ?? false,
                securityGeneration: record.securityGeneration,
              },
            }
          : { userId: record.userId };
      },
    );
  findUserMock.mockReset();
  markFactorChangeMock.mockReset().mockResolvedValue(true);
  deletePasskeysMock.mockReset().mockResolvedValue({ count: 1 });
  registrationDenialMock.mockReset().mockReturnValue(null);
});

async function authenticateConcurrently(
  credentials: readonly string[],
): Promise<Array<ReturnType<typeof vi.fn>>> {
  const { before, afterVerification } = productionPasskeyCallbacks();
  let release!: () => void;
  const overlap = new Promise<void>((resolve) => {
    release = resolve;
  });
  const cookies = credentials.map(() => vi.fn());
  const requests = credentials.map((credentialID, index) =>
    runWithRequestState(new WeakMap(), async () => {
      await before({
        path: "/passkey/verify-authentication",
        body: { response: { id: credentialID } },
      });
      await overlap;
      await afterVerification({
        clientData: { id: credentialID },
        ctx: { setCookie: cookies[index]! },
      });
    }),
  );

  release();
  await Promise.all(requests);
  return cookies;
}

describe("production passkey authentication wiring", () => {
  it("blocks direct passkey sign-in for a super admin without a password-first proof", async () => {
    passkeyRecords.set("super-credential", {
      isSuperAdmin: true,
      securityGeneration: 9,
      userId: "super-admin",
    });
    const { before } = productionPasskeyCallbacks();

    await expect(
      runWithRequestState(new WeakMap(), () =>
        before({
          body: { response: { id: "super-credential" } },
          headers: new Headers(),
          path: "/passkey/verify-authentication",
        }),
      ),
    ).rejects.toMatchObject({ status: "FORBIDDEN" });
  });

  it("does not cross-bind concurrent users between the before and verified callbacks", async () => {
    passkeyRecords.set("credential-a", { userId: "user-a", securityGeneration: 3 });
    passkeyRecords.set("credential-b", { userId: "user-b", securityGeneration: 8 });

    const cookies = await authenticateConcurrently(["credential-a", "credential-b"]);

    expect(cookies[0]).toHaveBeenCalledWith(
      expect.any(String),
      "ticket:user-a:3",
      expect.any(Object),
    );
    expect(cookies[1]).toHaveBeenCalledWith(
      expect.any(String),
      "ticket:user-b:8",
      expect.any(Object),
    );
  });

  it("does not rebind same-user requests to another captured generation", async () => {
    passkeyRecords.set("credential-old", { userId: "user-a", securityGeneration: 4 });
    passkeyRecords.set("credential-new", { userId: "user-a", securityGeneration: 5 });

    const cookies = await authenticateConcurrently(["credential-old", "credential-new"]);

    expect(cookies[0]?.mock.calls[0]?.[1]).toBe("ticket:user-a:4");
    expect(cookies[1]?.mock.calls[0]?.[1]).toBe("ticket:user-a:5");
  });
});

describe("production factor-mutation wiring", () => {
  it("rolls back a passkey when the generation-bound settings grant becomes stale", async () => {
    const { after, before } = productionPasskeyCallbacks();
    findUserMock.mockResolvedValue({
      id: "user-1",
      isSuperAdmin: false,
      platformRole: "student",
      securityGeneration: 8,
    });
    markFactorChangeMock.mockResolvedValue(false);

    await expect(
      runWithRequestState(new WeakMap(), async () => {
        await before({
          body: { response: { id: "new-credential" } },
          context: {
            session: {
              session: { id: "session-1" },
              user: {
                id: "user-1",
                isSuperAdmin: false,
                platformRole: "student",
                securityGeneration: 7,
              },
            },
          },
          path: "/passkey/verify-registration",
        });
        expect(findUserMock).toHaveBeenCalled();
        expect(await getPasskeyRegistrationProof()).toEqual({
          credentialID: "new-credential",
          securityGeneration: 8,
          sessionId: "session-1",
          userId: "user-1",
        });
        await after({ path: "/passkey/verify-registration" });
      }),
    ).rejects.toMatchObject({ status: "CONFLICT" });
    expect(deletePasskeysMock).toHaveBeenCalledWith({
      where: { credentialID: "new-credential", userId: "user-1" },
    });
  });

  it.each([
    "/two-factor/enable",
    "/two-factor/disable",
    "/two-factor/generate-backup-codes",
    "/passkey/delete-passkey",
  ])("blocks public mutation endpoint %s", async (path) => {
    const { before } = productionPasskeyCallbacks();

    await expect(
      runWithRequestState(new WeakMap(), () => before({ path, body: {} })),
    ).rejects.toMatchObject({ status: "FORBIDDEN" });
  });

  it("keeps TOTP verification available to the temporary sign-in flow", async () => {
    const { before } = productionPasskeyCallbacks();

    await expect(
      runWithRequestState(new WeakMap(), () =>
        before({ path: "/two-factor/verify-totp", body: {} }),
      ),
    ).resolves.toBeUndefined();
  });

  it("allows one path-bound internal factor mutation", async () => {
    const { before } = productionPasskeyCallbacks();

    await expect(
      runInternalFactorMutation(factorMutationPath.enable, () =>
        before({ path: factorMutationPath.enable, body: {} }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      runWithRequestState(new WeakMap(), () =>
        before({ path: factorMutationPath.enable, body: {} }),
      ),
    ).rejects.toMatchObject({ status: "FORBIDDEN" });
  });

  it("allows exactly one concurrent consumer of an internal authority", async () => {
    const consumed = await runInternalFactorMutation(factorMutationPath.enable, () =>
      Promise.all([
        consumeInternalFactorMutationAuthority(factorMutationPath.enable),
        consumeInternalFactorMutationAuthority(factorMutationPath.enable),
      ]),
    );

    expect(consumed.filter(Boolean)).toHaveLength(1);
  });
});

describe("super admin account-linking boundary", () => {
  it("allows credentials but rejects OAuth account creation", async () => {
    const options = (getAuth() as unknown as { options: CapturedAuthOptions }).options;
    const beforeCreate = options.databaseHooks.account.create.before;
    findUserMock.mockResolvedValue({ isSuperAdmin: true });

    await expect(
      beforeCreate({ providerId: "credential", userId: "super-admin" }),
    ).resolves.toBeUndefined();
    await expect(
      beforeCreate({ providerId: "google", userId: "super-admin" }),
    ).rejects.toMatchObject({ status: "FORBIDDEN" });
  });
});
