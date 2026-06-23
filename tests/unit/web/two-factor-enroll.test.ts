import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  generateOtpMock,
  storeEnrollOtpMock,
  verifyEnrollOtpMock,
  userHasCredentialPasswordMock,
  verifyStepUpCodeMock,
  clearStepUpMock,
  sendEmailMock,
  enableTwoFactorMock,
  verifyTotpMock,
  disableTwoFactorMock,
  generateBackupCodesMock,
  otpConsumeMock,
  cookiesSetMock,
} = vi.hoisted(() => ({
  generateOtpMock: vi.fn(),
  storeEnrollOtpMock: vi.fn(),
  verifyEnrollOtpMock: vi.fn(),
  userHasCredentialPasswordMock: vi.fn(),
  verifyStepUpCodeMock: vi.fn(),
  clearStepUpMock: vi.fn(),
  sendEmailMock: vi.fn(),
  enableTwoFactorMock: vi.fn(),
  verifyTotpMock: vi.fn(),
  disableTwoFactorMock: vi.fn(),
  generateBackupCodesMock: vi.fn(),
  otpConsumeMock: vi.fn(),
  cookiesSetMock: vi.fn(),
}));

vi.mock("@nojv/db", () => new Proxy({}, { get: () => ({}) }));

vi.mock("$lib/server/step-up", () => ({
  generateOtp: generateOtpMock,
  storeEnrollOtp: storeEnrollOtpMock,
  verifyEnrollOtp: verifyEnrollOtpMock,
  userHasCredentialPassword: userHasCredentialPasswordMock,
  verifyStepUpCode: verifyStepUpCodeMock,
  clearStepUp: clearStepUpMock,
}));

vi.mock("$lib/server/mailer", () => ({
  getMailer: () => ({ sendEmail: sendEmailMock }),
}));

vi.mock("$lib/auth.server", () => ({
  getAuth: () => ({
    api: {
      enableTwoFactor: enableTwoFactorMock,
      verifyTOTP: verifyTotpMock,
      disableTwoFactor: disableTwoFactorMock,
      generateBackupCodes: generateBackupCodesMock,
    },
  }),
}));

vi.mock("$lib/server/shared/rate-limiter", () => ({
  otpSendRateLimiter: { consume: otpConsumeMock },
}));

import { actions, load } from "$lib/../routes/(app)/account/two-factor/+page.server";

const FRESH = new Date();
const STALE = new Date(Date.now() - 10 * 60 * 1000);

function makeEvent(opts?: {
  twoFactorEnabled?: boolean;
  sessionCreatedAt?: Date;
  body?: FormData;
  returnTo?: string;
}): RequestEvent {
  const url = new URL("http://localhost/account/two-factor");
  if (opts?.returnTo) url.searchParams.set("returnTo", opts.returnTo);
  return {
    locals: {
      user: { id: "usr_1" },
      session: { createdAt: opts?.sessionCreatedAt ?? FRESH },
      sessionUser: {
        id: "usr_1",
        username: "alice",
        name: "Alice",
        email: "a@example.com",
        emailVerified: true,
        platformRole: "student",
        twoFactorEnabled: opts?.twoFactorEnabled ?? false,
        disabled: false,
        mustChangePassword: false,
      },
      apiTokenActor: null,
    },
    request: new Request("http://localhost/account/two-factor", {
      method: "POST",
      body: opts?.body ?? new FormData(),
    }),
    cookies: { set: cookiesSetMock },
    url,
  } as unknown as RequestEvent;
}

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

async function caught(
  fn: () => Promise<unknown>,
): Promise<{ status: number; location: string }> {
  try {
    await fn();
    throw new Error("expected a redirect to be thrown");
  } catch (err) {
    return err as { status: number; location: string };
  }
}

beforeEach(() => {
  generateOtpMock.mockReset().mockReturnValue("123456");
  storeEnrollOtpMock.mockReset().mockResolvedValue(undefined);
  verifyEnrollOtpMock.mockReset();
  userHasCredentialPasswordMock.mockReset().mockResolvedValue(false);
  verifyStepUpCodeMock.mockReset();
  clearStepUpMock.mockReset().mockResolvedValue(undefined);
  sendEmailMock.mockReset().mockResolvedValue(undefined);
  enableTwoFactorMock.mockReset();
  verifyTotpMock.mockReset();
  disableTwoFactorMock.mockReset();
  generateBackupCodesMock.mockReset();
  otpConsumeMock.mockReset().mockResolvedValue(undefined);
  cookiesSetMock.mockReset();
});

describe("two-factor load", () => {
  it("sanitizes returnTo and reports hasPassword", async () => {
    userHasCredentialPasswordMock.mockResolvedValue(true);
    const ok = await load(makeEvent({ returnTo: "/account/api-tokens" }));
    expect(ok.returnTo).toBe("/account/api-tokens");
    expect(ok.hasPassword).toBe(true);

    const evil = await load(makeEvent({ returnTo: "https://evil.test" }));
    expect(evil.returnTo).toBeNull();
  });
});

describe("two-factor sendOtp (OAuth users only)", () => {
  it("fails 403 needsReauth when the session is stale", async () => {
    const result = await actions.sendOtp(makeEvent({ sessionCreatedAt: STALE }));
    expect(result).toMatchObject({ status: 403, data: { needsReauth: true } });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("fails 400 when 2FA is already enabled", async () => {
    const result = await actions.sendOtp(makeEvent({ twoFactorEnabled: true }));
    expect(result).toMatchObject({ status: 400 });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("fails 400 for password users (they confirm a password, not an OTP)", async () => {
    userHasCredentialPasswordMock.mockResolvedValue(true);
    const result = await actions.sendOtp(makeEvent());
    expect(result).toMatchObject({ status: 400 });
    expect(storeEnrollOtpMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("fails 429 when the OTP send rate limit is exceeded", async () => {
    otpConsumeMock.mockRejectedValue(new Error("rate limited"));
    const result = await actions.sendOtp(makeEvent());
    expect(result).toMatchObject({ status: 429 });
    expect(storeEnrollOtpMock).not.toHaveBeenCalled();
  });

  it("stores the OTP and emails it on success", async () => {
    const result = await actions.sendOtp(makeEvent());
    expect(storeEnrollOtpMock).toHaveBeenCalledWith("usr_1", "123456");
    expect(sendEmailMock).toHaveBeenCalledOnce();
    expect(sendEmailMock.mock.calls[0][0]).toMatchObject({ to: "a@example.com" });
    expect(result).toEqual({ sent: true });
  });
});

describe("two-factor enable — OAuth user (email OTP)", () => {
  it("fails 400 on a bad email OTP", async () => {
    verifyEnrollOtpMock.mockResolvedValue(false);
    const result = await actions.enable(makeEvent({ body: form({ otp: "000000" }) }));
    expect(result).toMatchObject({ status: 400 });
    expect(enableTwoFactorMock).not.toHaveBeenCalled();
  });

  it("fails 403 needsReauth when the session is stale", async () => {
    const result = await actions.enable(makeEvent({ sessionCreatedAt: STALE }));
    expect(result).toMatchObject({ status: 403, data: { needsReauth: true } });
  });

  it("calls enableTwoFactor with no password and returns totpURI + backupCodes", async () => {
    verifyEnrollOtpMock.mockResolvedValue(true);
    enableTwoFactorMock.mockResolvedValue({
      totpURI: "otpauth://totp/NOJV:a?secret=ABC",
      backupCodes: ["aaaaa-bbbbb"],
    });
    const result = await actions.enable(makeEvent({ body: form({ otp: "123456" }) }));
    expect(enableTwoFactorMock).toHaveBeenCalledWith({
      body: {},
      headers: expect.any(Headers),
    });
    expect(result).toEqual({
      totpURI: "otpauth://totp/NOJV:a?secret=ABC",
      backupCodes: ["aaaaa-bbbbb"],
    });
  });
});

describe("two-factor enable — password user", () => {
  it("fails 400 when no password is provided", async () => {
    userHasCredentialPasswordMock.mockResolvedValue(true);
    const result = await actions.enable(makeEvent({ body: form({}) }));
    expect(result).toMatchObject({ status: 400 });
    expect(enableTwoFactorMock).not.toHaveBeenCalled();
    expect(verifyEnrollOtpMock).not.toHaveBeenCalled();
  });

  it("passes the password to enableTwoFactor (no email OTP)", async () => {
    userHasCredentialPasswordMock.mockResolvedValue(true);
    enableTwoFactorMock.mockResolvedValue({
      totpURI: "otpauth://totp/NOJV:a?secret=ABC",
      backupCodes: ["aaaaa-bbbbb"],
    });
    const result = await actions.enable(makeEvent({ body: form({ password: "hunter2" }) }));
    expect(enableTwoFactorMock).toHaveBeenCalledWith({
      body: { password: "hunter2" },
      headers: expect.any(Headers),
    });
    expect(verifyEnrollOtpMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ totpURI: "otpauth://totp/NOJV:a?secret=ABC" });
  });

  it("returns fail(400) when better-auth rejects a wrong password", async () => {
    userHasCredentialPasswordMock.mockResolvedValue(true);
    enableTwoFactorMock.mockRejectedValue(new Error("INVALID_PASSWORD"));
    const result = await actions.enable(makeEvent({ body: form({ password: "wrong" }) }));
    expect(result).toMatchObject({ status: 400 });
  });
});

describe("two-factor verify", () => {
  it("fails 401 when verifyTOTP throws", async () => {
    verifyTotpMock.mockRejectedValue(new Error("invalid"));
    const result = await actions.verify(makeEvent({ body: form({ code: "000000" }) }));
    expect(result).toMatchObject({ status: 401 });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("sends the notification email and returns enabled on success", async () => {
    verifyTotpMock.mockResolvedValue({ headers: new Headers() });
    const result = await actions.verify(makeEvent({ body: form({ code: "123456" }) }));
    expect(verifyTotpMock).toHaveBeenCalledWith({
      body: { code: "123456" },
      headers: expect.any(Headers),
      returnHeaders: true,
    });
    expect(sendEmailMock).toHaveBeenCalledOnce();
    expect(result).toEqual({ enabled: true });
  });

  it("redirects to a sanitized returnTo after success", async () => {
    verifyTotpMock.mockResolvedValue({ headers: new Headers() });
    const body = form({ code: "123456", returnTo: "/account/api-tokens" });
    const thrown = await caught(() => actions.verify(makeEvent({ body })));
    expect(thrown.status).toBe(303);
    expect(thrown.location).toBe("/account/api-tokens");
  });

  it("still succeeds when the notification email fails", async () => {
    verifyTotpMock.mockResolvedValue({ headers: new Headers() });
    sendEmailMock.mockRejectedValue(new Error("smtp down"));
    const result = await actions.verify(makeEvent({ body: form({ code: "123456" }) }));
    expect(result).toEqual({ enabled: true });
  });

  it("forwards better-auth's rotated session cookie so enrolling does not log you out", async () => {
    verifyTotpMock.mockResolvedValue({
      headers: new Headers([
        ["set-cookie", "better-auth.session_token=newtoken; Path=/; HttpOnly; SameSite=Lax"],
      ]),
    });
    await actions.verify(makeEvent({ body: form({ code: "123456" }) }));
    expect(cookiesSetMock).toHaveBeenCalledWith(
      "better-auth.session_token",
      "newtoken",
      expect.objectContaining({ path: "/" }),
    );
  });
});

describe("two-factor disable", () => {
  it("fails 400 when 2FA is not enabled", async () => {
    const result = await actions.disable(makeEvent({ twoFactorEnabled: false }));
    expect(result).toMatchObject({ status: 400 });
    expect(disableTwoFactorMock).not.toHaveBeenCalled();
  });

  it("password user: passes password to disableTwoFactor", async () => {
    userHasCredentialPasswordMock.mockResolvedValue(true);
    disableTwoFactorMock.mockResolvedValue({ headers: new Headers() });
    const result = await actions.disable(
      makeEvent({ twoFactorEnabled: true, body: form({ password: "hunter2" }) }),
    );
    expect(disableTwoFactorMock).toHaveBeenCalledWith({
      body: { password: "hunter2" },
      headers: expect.any(Headers),
      returnHeaders: true,
    });
    expect(clearStepUpMock).toHaveBeenCalledWith("usr_1");
    expect(result).toEqual({ disabled: true });
  });

  it("password user: fail(400) on wrong password", async () => {
    userHasCredentialPasswordMock.mockResolvedValue(true);
    disableTwoFactorMock.mockRejectedValue(new Error("INVALID_PASSWORD"));
    const result = await actions.disable(
      makeEvent({ twoFactorEnabled: true, body: form({ password: "wrong" }) }),
    );
    expect(result).toMatchObject({ status: 400 });
    expect(clearStepUpMock).not.toHaveBeenCalled();
  });

  it("OAuth user: verifies an inline code then disables with empty body", async () => {
    verifyStepUpCodeMock.mockResolvedValue({ ok: true });
    disableTwoFactorMock.mockResolvedValue({ headers: new Headers() });
    const result = await actions.disable(
      makeEvent({ twoFactorEnabled: true, body: form({ code: "123456" }) }),
    );
    expect(verifyStepUpCodeMock).toHaveBeenCalledWith("usr_1", "123456", expect.any(Headers));
    expect(disableTwoFactorMock).toHaveBeenCalledWith({
      body: {},
      headers: expect.any(Headers),
      returnHeaders: true,
    });
    expect(clearStepUpMock).toHaveBeenCalledWith("usr_1");
    expect(result).toEqual({ disabled: true });
  });

  it("OAuth user: fail(401) on a bad inline code", async () => {
    verifyStepUpCodeMock.mockResolvedValue({ ok: false, reason: "invalid" });
    const result = await actions.disable(
      makeEvent({ twoFactorEnabled: true, body: form({ code: "000000" }) }),
    );
    expect(result).toMatchObject({ status: 401 });
    expect(disableTwoFactorMock).not.toHaveBeenCalled();
  });
});

describe("two-factor regenerate", () => {
  it("fails 400 when 2FA is not enabled", async () => {
    const result = await actions.regenerate(makeEvent({ twoFactorEnabled: false }));
    expect(result).toMatchObject({ status: 400 });
    expect(generateBackupCodesMock).not.toHaveBeenCalled();
  });

  it("password user: passes password and returns fresh codes", async () => {
    userHasCredentialPasswordMock.mockResolvedValue(true);
    generateBackupCodesMock.mockResolvedValue({ status: true, backupCodes: ["11111-22222"] });
    const result = await actions.regenerate(
      makeEvent({ twoFactorEnabled: true, body: form({ password: "hunter2" }) }),
    );
    expect(generateBackupCodesMock).toHaveBeenCalledWith({
      body: { password: "hunter2" },
      headers: expect.any(Headers),
    });
    expect(result).toEqual({ backupCodes: ["11111-22222"] });
  });

  it("OAuth user: verifies an inline code then regenerates with empty body", async () => {
    verifyStepUpCodeMock.mockResolvedValue({ ok: true });
    generateBackupCodesMock.mockResolvedValue({ status: true, backupCodes: ["33333-44444"] });
    const result = await actions.regenerate(
      makeEvent({ twoFactorEnabled: true, body: form({ code: "123456" }) }),
    );
    expect(generateBackupCodesMock).toHaveBeenCalledWith({
      body: {},
      headers: expect.any(Headers),
    });
    expect(result).toEqual({ backupCodes: ["33333-44444"] });
  });

  it("OAuth user: fail(401) on a bad inline code", async () => {
    verifyStepUpCodeMock.mockResolvedValue({ ok: false, reason: "invalid" });
    const result = await actions.regenerate(
      makeEvent({ twoFactorEnabled: true, body: form({ code: "000000" }) }),
    );
    expect(result).toMatchObject({ status: 401 });
    expect(generateBackupCodesMock).not.toHaveBeenCalled();
  });
});
