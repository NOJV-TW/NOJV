import { isRedirect } from "@sveltejs/kit";
import { beforeAll, describe, expect, it, vi } from "vitest";

const state = await vi.hoisted(async () => {
  const { createRequire } = await import("node:module");
  const requireFromWeb = createRequire(
    new URL("../../../apps/web/package.json", import.meta.url),
  );
  return {
    cookies: new Map<string, string>(),
    database: { user: [], session: [], account: [], verification: [] },
    prismaAdapterPath: requireFromWeb.resolve("better-auth/adapters/prisma"),
    memoryAdapterPath: requireFromWeb.resolve("better-auth/adapters/memory"),
  };
});

vi.mock(state.prismaAdapterPath, async () => {
  const { memoryAdapter } = await import(state.memoryAdapterPath);
  return { prismaAdapter: () => memoryAdapter(state.database) };
});
vi.mock("@nojv/application", () => ({
  adminMfaKind: () => "none",
  areSecuritySettingsUnlocked: vi.fn(),
  createStepUpHandoffTicket: vi.fn(),
  hasAdminSessionMfa: vi.fn(),
  isSuperAdminSessionExpired: vi.fn(),
  markFactorChangeVerifiedSession: vi.fn(),
  markVerifiedSession: vi.fn(),
  passkeyRegistrationDenialReason: vi.fn(),
  securityGenerationProof: vi.fn(),
  userDomain: { linkUserCourseRoster: vi.fn() },
  notificationDomain: { getNotificationPreferences: vi.fn().mockResolvedValue({}) },
}));
vi.mock("@nojv/db", () => ({
  prismaAdapterClient: {
    user: { findUnique: vi.fn().mockResolvedValue({ isSuperAdmin: false }) },
  },
}));
vi.mock("@nojv/mailer", () => ({ getMailer: vi.fn(), renderEmail: vi.fn() }));
vi.mock("$lib/server/env", () => ({
  getWebEnv: () => ({
    BETTER_AUTH_SECRET: "test-secret-at-least-32-characters",
    BETTER_AUTH_URL: "https://nojv.test",
    NODE_ENV: "test",
    GITHUB_CLIENT_ID: "test-github",
    GITHUB_CLIENT_SECRET: "test-github-secret",
    GOOGLE_CLIENT_ID: "test-google",
    GOOGLE_CLIENT_SECRET: "test-google-secret",
  }),
}));
vi.mock("$lib/server/shared/rate-limiter", () => ({
  consumeFormRateLimitInternal: vi.fn().mockResolvedValue(null),
}));
vi.mock("$lib/server/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("$lib/server/shared/school-verification", () => ({
  handleSendVerificationAction: vi.fn(),
}));
vi.mock("$lib/../routes/(app)/settings/two-factor-actions", () => ({
  loadTwoFactor: vi.fn().mockResolvedValue({}),
  twoFactorActions: {},
}));
vi.mock("sveltekit-superforms/server", () => ({
  message: vi.fn(),
  superValidate: vi.fn().mockResolvedValue({}),
}));

import { getAuth } from "$lib/auth.server";
import { actions, load } from "$lib/../routes/(app)/settings/+page.server";

let sessionCookie: string;
let userId: string;

beforeAll(async () => {
  const auth = getAuth();
  const context = await auth.$context;
  vi.spyOn(context.logger, "error").mockImplementation(() => {});
  const user = await context.internalAdapter.createUser({
    name: "Account link test",
    email: "link@example.com",
    emailVerified: true,
  });
  userId = user.id;
  await context.internalAdapter.createAccount({
    userId,
    providerId: "credential",
    accountId: userId,
    password: await context.password.hash("test-account-password"),
  });
  const response = await auth.handler(
    new Request("https://nojv.test/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://nojv.test" },
      body: JSON.stringify({ email: user.email, password: "test-account-password" }),
    }),
  );
  expect(response.status).toBe(200);
  sessionCookie = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
  for (const provider of context.socialProviders) {
    provider.validateAuthorizationCode = async () => ({ accessToken: "test-access-token" });
    provider.getUserInfo = async () => ({
      user: {
        id: `linked-${provider.id}`,
        email: user.email,
        emailVerified: true,
        name: user.name,
      },
      data: {},
    });
  }
});

describe("account linking from a server action", () => {
  it.each(["github", "google"] as const)(
    "persists %s binding for the current session",
    async (provider) => {
      state.cookies.clear();
      const auth = getAuth();
      const headers = new Headers({ cookie: sessionCookie, origin: "https://nojv.test" });
      const body = new FormData();
      body.set("provider", provider);
      const session = await auth.api.getSession({ headers });
      const event = {
        cookies: { set: (name: string, value: string) => state.cookies.set(name, value) },
        locals: { user: session!.user, sessionUser: session!.user },
        url: new URL("https://nojv.test/settings"),
        request: new Request("https://nojv.test/settings?/link", {
          method: "POST",
          headers,
          body,
        }),
      } as unknown as Parameters<typeof load>[0];
      const redirect = await actions.link(event).catch((error: unknown) => error);
      if (!isRedirect(redirect))
        throw new Error("Account linking did not redirect to the provider");
      expect(redirect.status).toBe(303);
      const callback = new URL(`https://nojv.test/api/auth/callback/${provider}`);
      callback.searchParams.set("code", "test-authorization-code");
      callback.searchParams.set("state", new URL(redirect.location).searchParams.get("state")!);
      const callbackCookies = [...state.cookies]
        .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
        .join("; ");
      const response = await auth.handler(
        new Request(callback, {
          headers: { cookie: `${sessionCookie}; ${callbackCookies}` },
        }),
      );

      expect(response.headers.get("location")).toBe("/settings");
      const accounts = await auth.api.listUserAccounts({ headers });
      expect(accounts).toContainEqual(
        expect.objectContaining({ providerId: provider, userId }),
      );
      expect((await load(event))?.providers).toContainEqual({ provider, linked: true });
      expect((await auth.api.getSession({ headers }))?.session.id).toBe(session!.session.id);
    },
  );
});
