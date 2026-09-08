import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authOptions: null as Record<string, any> | null,
  sendEmail: vi.fn(),
}));

vi.mock("better-auth", () => ({
  betterAuth: (options: Record<string, any>) => {
    state.authOptions = options;
    return { options };
  },
}));
vi.mock("better-auth/adapters/prisma", () => ({ prismaAdapter: () => ({}) }));
vi.mock("better-auth/api", () => ({
  APIError: class APIError extends Error {
    status: string;

    constructor(status: string, options: { message: string }) {
      super(options.message);
      this.status = status;
    }
  },
  createAuthMiddleware: (handler: unknown) => handler,
  getSessionFromCtx: vi.fn(),
  isAPIError: vi.fn(() => false),
}));
vi.mock("better-auth/plugins", () => ({
  twoFactor: () => ({ id: "two-factor" }),
  username: () => ({ id: "username" }),
}));
vi.mock("@better-auth/passkey", () => ({ passkey: () => ({ id: "passkey" }) }));
vi.mock("@nojv/application", () => ({
  adminMfaKind: vi.fn(),
  areSecuritySettingsUnlocked: vi.fn(),
  createStepUpHandoffTicket: vi.fn(),
  hasAdminSessionMfa: vi.fn(),
  isSuperAdminSessionExpired: vi.fn(),
  markFactorChangeVerifiedSession: vi.fn(),
  markVerifiedSession: vi.fn(),
  passkeyRegistrationDenialReason: vi.fn(),
  securityGenerationProof: vi.fn(),
  userDomain: { linkUserCourseRoster: vi.fn() },
}));
vi.mock("@nojv/db", () => ({ prismaAdapterClient: {} }));
vi.mock("@nojv/mailer", () => ({
  getMailer: () => ({ sendEmail: state.sendEmail }),
  renderEmail: (content: unknown) => JSON.stringify(content),
}));
vi.mock("$lib/server/env", () => ({
  getWebEnv: () => ({
    BETTER_AUTH_SECRET: "test-secret-at-least-32-characters",
    BETTER_AUTH_URL: "https://nojv.test",
    NODE_ENV: "test",
  }),
}));
vi.mock("$lib/server/auth-factor-mutation", () => ({
  consumeInternalFactorMutationAuthority: vi.fn(),
  factorMutationPath: { enable: "/two-factor/enable" },
}));
vi.mock("$lib/server/passkey-request-proof", () => ({
  getPasskeyAuthenticationProof: vi.fn(),
  getPasskeyRegistrationProof: vi.fn(),
  setPasskeyAuthenticationProof: vi.fn(),
  setPasskeyRegistrationProof: vi.fn(),
}));
vi.mock("$lib/server/step-up-handoff", () => ({ STEP_UP_HANDOFF_COOKIE: "step-up" }));
vi.mock("$lib/server/super-admin-password-proof", () => ({
  consumeSuperAdminPasswordProof: vi.fn(),
  isSuperAdminPasswordProofSessionValid: vi.fn(),
  passwordProofTicketFromCookieHeader: vi.fn(),
  readSuperAdminPasswordProof: vi.fn(),
}));

const { getAuth } = await import("$lib/auth.server");

beforeEach(() => {
  state.sendEmail.mockReset().mockResolvedValue("accepted");
});

describe("email change Better Auth wiring", () => {
  it("escapes the requested address before putting it in confirmation HTML", async () => {
    const options = (getAuth() as unknown as { options: Record<string, any> }).options;
    const sendChangeEmailConfirmation = options.user.changeEmail
      .sendChangeEmailConfirmation as (input: Record<string, any>) => Promise<void>;

    await sendChangeEmailConfirmation({
      user: { email: "current@example.com" },
      newEmail: 'new&<script>alert("x")</script>@example.com',
      url: "https://nojv.test/verify-email?token=test",
    });

    const html = state.sendEmail.mock.calls[0]?.[0]?.html as string;
    expect(html).toContain(
      "new&amp;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;@example.com",
    );
    expect(html).not.toContain('<script>alert("x")</script>');
  });
});
