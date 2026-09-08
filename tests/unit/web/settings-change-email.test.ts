import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  changeEmail: vi.fn(),
  consumeRateLimit: vi.fn(),
  getNotificationPreferences: vi.fn(),
  message: vi.fn(),
  requireAuth: vi.fn(),
  sendVerificationEmail: vi.fn(),
  superValidate: vi.fn(),
}));

vi.mock("$lib/server/shared/rate-limiter", () => ({
  consumeFormRateLimitInternal: mocks.consumeRateLimit,
}));
vi.mock("$lib/auth.server", () => ({
  getAuth: () => ({
    api: {
      changeEmail: mocks.changeEmail,
      listUserAccounts: vi.fn(),
      sendVerificationEmail: mocks.sendVerificationEmail,
    },
  }),
}));
vi.mock("$lib/server/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("$lib/server/shared/school-verification", () => ({
  handleSendVerificationAction: vi.fn(),
}));
vi.mock("$lib/../routes/(app)/settings/two-factor-actions", () => ({
  loadTwoFactor: vi.fn(),
  twoFactorActions: {},
}));
vi.mock("@nojv/application", () => ({
  notificationDomain: {
    getNotificationPreferences: mocks.getNotificationPreferences,
    updateNotificationPreferences: vi.fn(),
  },
}));
vi.mock("sveltekit-superforms/server", () => ({
  message: mocks.message,
  superValidate: mocks.superValidate,
}));
vi.mock("sveltekit-superforms/adapters", () => ({ zod4: vi.fn() }));

const { actions, load } = await import("$lib/../routes/(app)/settings/+page.server");

function makeEvent(): RequestEvent {
  const formData = new FormData();
  formData.set("newEmail", "new@example.com");
  return {
    locals: { user: { id: "usr_1", email: "new@example.com" } },
    request: new Request("http://localhost/settings", {
      method: "POST",
      body: formData,
      headers: { "x-test": "settings" },
    }),
  } as unknown as RequestEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.consumeRateLimit.mockResolvedValue(null);
  mocks.requireAuth.mockReturnValue({ userId: "usr_1", emailVerified: true });
  mocks.getNotificationPreferences.mockResolvedValue({});
  mocks.superValidate.mockResolvedValue({
    valid: true,
    data: { newEmail: "new@example.com" },
  });
  mocks.message.mockImplementation((_form, payload, options) => ({
    ...payload,
    ...(options ?? {}),
  }));
  mocks.changeEmail.mockResolvedValue({ status: true });
  mocks.sendVerificationEmail.mockResolvedValue({ status: true });
});

describe("settings email change action", () => {
  it("starts Better Auth verification for the requested address", async () => {
    await expect(actions.changeEmail(makeEvent())).resolves.toEqual({
      kind: "success",
      text: "account_emailChange_verificationSent",
    });

    expect(mocks.changeEmail).toHaveBeenCalledWith({
      body: { newEmail: "new@example.com", callbackURL: "/settings" },
      headers: expect.any(Headers),
    });
  });

  it("does not call Better Auth when form validation fails", async () => {
    mocks.superValidate.mockResolvedValueOnce({ valid: false, data: {} });

    await expect(actions.changeEmail(makeEvent())).resolves.toMatchObject({ status: 400 });
    expect(mocks.changeEmail).not.toHaveBeenCalled();
  });

  it("uses direct-verification guidance for an unverified account", async () => {
    mocks.requireAuth.mockReturnValue({ userId: "usr_1", emailVerified: false });

    await expect(actions.changeEmail(makeEvent())).resolves.toEqual({
      kind: "success",
      text: "account_emailChange_verificationSentUnverified",
    });
  });

  it("resends verification to the current address", async () => {
    mocks.requireAuth.mockReturnValue({ userId: "usr_1", emailVerified: false });

    await expect(actions.resendEmailVerification(makeEvent())).resolves.toEqual({
      success: true,
    });

    expect(mocks.sendVerificationEmail).toHaveBeenCalledWith({
      body: { email: "new@example.com", callbackURL: "/settings" },
      headers: expect.any(Headers),
    });
  });

  it("returns a form error when resending verification fails", async () => {
    mocks.requireAuth.mockReturnValue({ userId: "usr_1", emailVerified: false });
    mocks.sendVerificationEmail.mockRejectedValueOnce(new Error("expired request"));

    await expect(actions.resendEmailVerification(makeEvent())).resolves.toMatchObject({
      status: 400,
      data: { error: "account_emailVerification_resendFailed" },
    });
  });

  it("returns a form error when Better Auth rejects the request", async () => {
    mocks.changeEmail.mockRejectedValueOnce(new Error("email already in use"));

    await expect(actions.changeEmail(makeEvent())).resolves.toMatchObject({ status: 400 });
    expect(mocks.message).toHaveBeenCalledWith(
      expect.anything(),
      { kind: "error", text: "account_emailChange_failed" },
      { status: 400 },
    );
  });
});

describe("settings email verification callback", () => {
  it.each([
    ["INVALID_TOKEN", "invalidToken"],
    ["TOKEN_EXPIRED", "tokenExpired"],
  ])("exposes %s as a localized callback error", async (error, expected) => {
    const event = {
      locals: {
        user: { id: "usr_1", email: "current@example.com" },
        sessionUser: { isSuperAdmin: true },
      },
      url: new URL(`http://localhost/settings?error=${error}`),
      request: new Request("http://localhost/settings"),
    };

    const result = await load(event as never);

    expect(result.emailVerificationError).toBe(expected);
  });

  it("disables initial email form validation errors", async () => {
    const event = {
      locals: {
        user: { id: "usr_1", email: "current@example.com" },
        sessionUser: { isSuperAdmin: true },
      },
      url: new URL("http://localhost/settings"),
      request: new Request("http://localhost/settings"),
    };

    await load(event as never);

    expect(mocks.superValidate).toHaveBeenNthCalledWith(2, { newEmail: "" }, undefined, {
      errors: false,
    });
  });
});
