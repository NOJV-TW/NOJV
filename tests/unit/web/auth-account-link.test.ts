import { isRedirect } from "@sveltejs/kit";
import { beforeAll, describe, expect, it, vi } from "vitest";

const state = await vi.hoisted(async () => {
  const { createRequire } = await import("node:module");
  const requireFromWeb = createRequire(
    new URL("../../../apps/web/package.json", import.meta.url),
  );
  return {
    cookies: new Map<string, string>(),
    sentEmails: [] as { to: string; subject: string }[],
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
  getSecurityFactorState: vi.fn().mockResolvedValue({ hasSecurityFactor: false }),
  ConflictError: class ConflictError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
  userDomain: {
    linkUserCourseRoster: vi.fn(),
    listLinkedAccountEmails: vi.fn().mockResolvedValue({}),
    deleteUser: vi.fn(),
  },
  notificationDomain: {
    getNotificationPreferences: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock("@nojv/db", () => ({
  prismaAdapterClient: {
    user: {
      findUnique: vi.fn().mockResolvedValue({ isSuperAdmin: false }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));
vi.mock("@nojv/mailer", () => ({
  getMailer: () => ({
    sendEmail: async (message: { to: string; subject: string }) => {
      state.sentEmails.push(message);
      return "sent";
    },
  }),
  renderEmail: () => "<html></html>",
}));
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

import {
  areSecuritySettingsUnlocked,
  getSecurityFactorState,
  userDomain,
} from "@nojv/application";
import { prismaAdapterClient } from "@nojv/db";
import { getAuth } from "$lib/auth.server";
import { requireAuth } from "$lib/server/auth";
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
      expect((await load(event))?.accounts).toContainEqual(
        expect.objectContaining({ provider, accountId: expect.any(String) }),
      );
      expect((await auth.api.getSession({ headers }))?.session.id).toBe(session!.session.id);
    },
  );
});

describe("unlinking one account of a provider", () => {
  it("removes only the named account and keeps the other binding", async () => {
    const auth = getAuth();
    const context = await auth.$context;
    const headers = new Headers({ cookie: sessionCookie, origin: "https://nojv.test" });
    await context.internalAdapter.createAccount({
      userId,
      providerId: "google",
      accountId: "second-google",
    });

    const body = new FormData();
    body.set("provider", "google");
    body.set("accountId", "second-google");
    const session = await auth.api.getSession({ headers });
    const event = {
      locals: { user: session!.user, sessionUser: session!.user },
      url: new URL("https://nojv.test/settings"),
      request: new Request("https://nojv.test/settings?/unlink", {
        method: "POST",
        headers,
        body,
      }),
    } as unknown as Parameters<typeof load>[0];

    await expect(actions.unlink(event)).resolves.toEqual({ unlinked: "google" });

    const googleIds = (await auth.api.listUserAccounts({ headers }))
      .filter((account) => account.providerId === "google")
      .map((account) => account.accountId);
    expect(googleIds).toEqual(["linked-google"]);
  });
});

describe("sign-in with an unknown provider identity that shares an email", () => {
  it("does not implicitly link it to the existing account", async () => {
    state.cookies.clear();
    const auth = getAuth();
    const context = await auth.$context;
    for (const provider of context.socialProviders) {
      provider.getUserInfo = async () => ({
        user: {
          id: `stranger-${provider.id}`,
          email: "link@example.com",
          emailVerified: true,
          name: "Recycled mailbox",
        },
        data: {},
      });
    }
    const before = (await context.internalAdapter.findAccounts(userId)).length;

    const start = await auth.api.signInSocial({
      body: { provider: "google", callbackURL: "/", errorCallbackURL: "/signin" },
      headers: new Headers({ origin: "https://nojv.test" }),
      returnHeaders: true,
    });
    const setCookies = start.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
    const callback = new URL("https://nojv.test/api/auth/callback/google");
    callback.searchParams.set("code", "test-authorization-code");
    callback.searchParams.set("state", new URL(start.response.url!).searchParams.get("state")!);
    const response = await auth.handler(
      new Request(callback, { headers: { cookie: setCookies } }),
    );

    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/signin");
    expect(location).toContain("error=account_not_linked");
    expect((await context.internalAdapter.findAccounts(userId)).length).toBe(before);
  });
});

describe("deleting your own account", () => {
  async function callDeleteAccount(confirmation: string) {
    const auth = getAuth();
    const headers = new Headers({ cookie: sessionCookie, origin: "https://nojv.test" });
    const session = await auth.api.getSession({ headers });
    const body = new FormData();
    body.set("confirmation", confirmation);
    const deletedCookies: string[] = [];
    const event = {
      cookies: { delete: (name: string) => deletedCookies.push(name) },
      locals: { user: session!.user, sessionUser: session!.user },
      url: new URL("https://nojv.test/settings"),
      request: new Request("https://nojv.test/settings?/deleteAccount", {
        method: "POST",
        headers,
        body,
      }),
    } as unknown as Parameters<typeof load>[0];
    vi.mocked(requireAuth).mockReturnValue({
      userId,
    } as unknown as ReturnType<typeof requireAuth>);
    const outcome = await actions.deleteAccount(event).catch((error: unknown) => error);
    return { outcome, deletedCookies };
  }

  it("refuses a confirmation that is not the account email", async () => {
    vi.mocked(userDomain.deleteUser).mockClear();
    const { outcome } = await callDeleteAccount("link@example.co");
    expect(outcome).toMatchObject({ status: 400, data: { error: "deleteConfirmation" } });
    expect(userDomain.deleteUser).not.toHaveBeenCalled();
  });

  it("deletes the account and drops the session cookie on an exact confirmation", async () => {
    vi.mocked(userDomain.deleteUser).mockResolvedValue({
      mode: "hard",
      name: "Account link test",
    });
    const { outcome, deletedCookies } = await callDeleteAccount("  LINK@example.com  ");
    if (!isRedirect(outcome)) throw new Error("Account deletion did not redirect");
    expect(outcome.status).toBe(303);
    expect(outcome.location).toBe("/");
    expect(userDomain.deleteUser).toHaveBeenCalledWith(false, userId);
    expect(deletedCookies).toEqual([expect.stringContaining("session_token")]);
  });
});

describe("changing the security mailbox", () => {
  function changeEmail(newEmail: string) {
    return getAuth().api.changeEmail({
      body: { newEmail, callbackURL: "/settings" },
      headers: new Headers({ cookie: sessionCookie, origin: "https://nojv.test" }),
    });
  }

  it("sends the confirmation to the current mailbox, never the new one", async () => {
    vi.mocked(getSecurityFactorState).mockResolvedValue({
      hasSecurityFactor: false,
    } as unknown as Awaited<ReturnType<typeof getSecurityFactorState>>);
    vi.mocked(prismaAdapterClient.user.findFirst).mockResolvedValue(null);
    state.sentEmails.length = 0;

    await changeEmail("moved@example.com");

    expect(state.sentEmails).toHaveLength(1);
    expect(state.sentEmails[0]!.to).toBe("link@example.com");
    await expect(
      (await getAuth().$context).internalAdapter.findUserById(userId),
    ).resolves.toMatchObject({ email: "link@example.com" });
  });

  it("refuses an address another account already owns", async () => {
    vi.mocked(prismaAdapterClient.user.findFirst).mockResolvedValue({
      id: "someone-else",
    } as Awaited<ReturnType<typeof prismaAdapterClient.user.findFirst>>);
    state.sentEmails.length = 0;

    await expect(changeEmail("taken@example.com")).rejects.toMatchObject({
      status: "CONFLICT",
    });
    expect(state.sentEmails).toHaveLength(0);
  });

  it("refuses while a security factor exists and settings are locked", async () => {
    vi.mocked(prismaAdapterClient.user.findFirst).mockResolvedValue(null);
    vi.mocked(getSecurityFactorState).mockResolvedValue({
      hasSecurityFactor: true,
    } as unknown as Awaited<ReturnType<typeof getSecurityFactorState>>);
    vi.mocked(areSecuritySettingsUnlocked).mockResolvedValue(false);
    state.sentEmails.length = 0;

    await expect(changeEmail("stepup@example.com")).rejects.toMatchObject({
      status: "FORBIDDEN",
    });
    expect(state.sentEmails).toHaveLength(0);

    vi.mocked(getSecurityFactorState).mockResolvedValue({
      hasSecurityFactor: false,
    } as unknown as Awaited<ReturnType<typeof getSecurityFactorState>>);
  });
});
