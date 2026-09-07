import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findAdminSignInUser, getSecurityFactorState, signInEmail } = vi.hoisted(() => ({
  findAdminSignInUser: vi.fn(),
  getSecurityFactorState: vi.fn(),
  signInEmail: vi.fn(),
}));

vi.mock("@nojv/application", async (original) => ({
  ...(await original<typeof import("@nojv/application")>()),
  findAdminSignInUser,
  getSecurityFactorState,
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

const { actions } = await import("$lib/../routes/(auth)/admin-signin/+page.server");

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
    cookies: { set: vi.fn() },
    getClientAddress: () => "127.0.0.1",
  } as unknown as RequestEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
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
