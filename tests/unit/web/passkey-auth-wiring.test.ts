import {
  getRequestStateAsyncLocalStorage,
  runWithRequestState,
} from "@better-auth/core/context";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { createTicketMock, findPasskeyMock, passkeyRecords, userRepoMock } = vi.hoisted(() => ({
  createTicketMock: vi.fn(),
  findPasskeyMock: vi.fn(),
  passkeyRecords: new Map<string, { userId: string; securityGeneration: number }>(),
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
  createStepUpHandoffTicket: createTicketMock,
  hasFreshStepUp: vi.fn(),
  hasTwoFactorChangeGrant: vi.fn(),
  passkeyRegistrationDenialReason: vi.fn(),
  securityGenerationProof: (user: { id: string; securityGeneration: number }) => ({
    userId: user.id,
    securityGeneration: user.securityGeneration,
  }),
}));

vi.mock("@nojv/db", () => ({
  prismaAdapterClient: { passkey: { findFirst: findPasskeyMock } },
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

interface PasskeyHookContext {
  body: { response: { id: string } };
  path: string;
}

interface PasskeyAfterVerificationInput {
  clientData: { id: string };
  ctx: { setCookie: ReturnType<typeof vi.fn> };
}

interface CapturedAuthOptions {
  hooks: { before: (ctx: PasskeyHookContext) => Promise<void> };
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
  return { before: options.hooks.before, afterVerification };
}

beforeAll(async () => {
  await getRequestStateAsyncLocalStorage();
});

beforeEach(() => {
  passkeyRecords.clear();
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
                securityGeneration: record.securityGeneration,
              },
            }
          : { userId: record.userId };
      },
    );
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
