import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findAdminSignInUser,
  getSecurityFactorState,
  signInEmail,
  hasAdminSessionMfa,
  pendingRegularAdminSignIn,
  readSuperAdminPasswordProof,
  getSuperAdminSecurityUser,
} = vi.hoisted(() => ({
  findAdminSignInUser: vi.fn(),
  getSecurityFactorState: vi.fn(),
  signInEmail: vi.fn(),
  hasAdminSessionMfa: vi.fn(),
  pendingRegularAdminSignIn: vi.fn(),
  readSuperAdminPasswordProof: vi.fn(),
  getSuperAdminSecurityUser: vi.fn(),
}));

vi.mock("@nojv/application", async (original) => ({
  ...(await original<typeof import("@nojv/application")>()),
  findAdminSignInUser,
  getSecurityFactorState,
  hasAdminSessionMfa,
  getSuperAdminSecurityUser,
}));
vi.mock("$lib/auth.server", () => ({
  getAuth: () => ({ api: { signInEmail } }),
}));
vi.mock("$lib/server/shared/rate-limiter", () => ({
  consumeFormRateLimitInternal: async () => null,
  signInRateLimiter: { consume: async () => "allowed" },
  otpSendRateLimiter: {},
  stepUpAttemptRateLimiter: {},
}));

vi.mock("$lib/server/admin-signin-state", () => ({ pendingRegularAdminSignIn }));
vi.mock("$lib/server/super-admin-password-proof", async (original) => ({
  ...(await original<typeof import("$lib/server/super-admin-password-proof")>()),
  readSuperAdminPasswordProof,
}));

const { actions, load } = await import("$lib/../routes/(auth)/admin-signin/+page.server");

function passwordEvent(): RequestEvent {
  const url = new URL("http://localhost/admin-signin?/password&returnTo=/admin");
  return {
    url,
    request: new Request(url, {
      method: "POST",
      headers: { accept: "text/html" },
      body: new URLSearchParams({ identity: "admin@example.test", password: "password" }),
    }),
    locals: {},
    cookies: { set: vi.fn(), get: vi.fn() },
    getClientAddress: () => "127.0.0.1",
  } as unknown as RequestEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  hasAdminSessionMfa.mockResolvedValue(false);
  pendingRegularAdminSignIn.mockResolvedValue(null);
  readSuperAdminPasswordProof.mockResolvedValue(null);
  findAdminSignInUser.mockResolvedValue({
    id: "regular-admin",
    platformRole: "admin",
    isSuperAdmin: false,
  });
  getSecurityFactorState.mockResolvedValue({
    hasPasskey: false,
    hasTotp: true,
    hasSecurityFactor: true,
  });
});

describe("regular-admin password action", () => {
  it("includes the dashboard destination for an unenhanced MFA response", async () => {
    signInEmail.mockResolvedValue({
      headers: new Headers(),
      response: { twoFactorRedirect: true },
    });

    const result = await actions.password!(passwordEvent());

    expect(result).toEqual({
      destination: "/dashboard",
      hasPasskey: false,
      hasTotp: true,
      phase: "verify-factor",
      regularAdmin: true,
    });
  });

  it("keeps password-only sign-in on the same dashboard destination", async () => {
    signInEmail.mockResolvedValue({ headers: new Headers(), response: { token: "session" } });

    const result = await actions.password!(passwordEvent());

    expect(result).toEqual({ destination: "/dashboard", phase: "complete" });
  });
});

describe("admin sign-in resume", () => {
  function superAdminEvent() {
    const event = passwordEvent();
    event.locals = {
      sessionUser: { id: "super-admin", isSuperAdmin: true, securityGeneration: 1 },
      session: { id: "session-1" },
    } as never;
    getSecurityFactorState.mockResolvedValue({
      hasPasskey: true,
      hasTotp: false,
      hasSecurityFactor: true,
    });
    return event;
  }

  it("returns to password when a passkey-only password proof expires", async () => {
    await expect(load(superAdminEvent() as never)).resolves.toMatchObject({
      phase: "password",
    });
  });

  it("resumes super admin verification only with a valid session-bound proof", async () => {
    const event = superAdminEvent();
    event.cookies.get = () => "ticket";
    readSuperAdminPasswordProof.mockResolvedValue({
      userId: "super-admin",
      sessionId: "session-1",
    });
    getSuperAdminSecurityUser.mockResolvedValue({ isSuperAdmin: true });
    await expect(load(event as never)).resolves.toMatchObject({ phase: "verify-factor" });
    readSuperAdminPasswordProof.mockResolvedValue({
      userId: "super-admin",
      sessionId: "different-session",
    });
    await expect(load(event as never)).resolves.toMatchObject({ phase: "password" });
  });

  it("resumes a regular admin's verified pending challenge with dashboard destination", async () => {
    pendingRegularAdminSignIn.mockResolvedValue("regular-admin");
    await expect(load(passwordEvent() as never)).resolves.toMatchObject({
      phase: "verify-factor",
      regularAdmin: true,
      returnTo: "/dashboard",
      hasTotp: true,
    });
  });

  it("returns to password when the pending challenge is absent or invalid", async () => {
    await expect(load(passwordEvent() as never)).resolves.toMatchObject({
      phase: "password",
      regularAdmin: false,
    });
  });
});
