import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  isTwoFactorActivatedMock,
  setTwoFactorActivatedMock,
  generateActivationOtpMock,
  storeActivationOtpMock,
  verifyActivationOtpMock,
  markChangeGrantMock,
  hasChangeGrantMock,
  clearChangeGrantMock,
  userHasCredentialPasswordMock,
  verifyStepUpCodeMock,
  clearStepUpMock,
  hasStepUpFactorMock,
  hasFreshStepUpMock,
  markVerifiedSessionMock,
  grantAdminElevationMock,
  consumeTotpCodeMock,
  sendEmailMock,
  enableTwoFactorMock,
  verifyTotpMock,
  disableTwoFactorMock,
  generateBackupCodesMock,
  listPasskeysMock,
  deletePasskeyMock,
  otpConsumeMock,
  stepUpConsumeMock,
  cookiesSetMock,
} = vi.hoisted(() => ({
  isTwoFactorActivatedMock: vi.fn(),
  setTwoFactorActivatedMock: vi.fn(),
  generateActivationOtpMock: vi.fn(),
  storeActivationOtpMock: vi.fn(),
  verifyActivationOtpMock: vi.fn(),
  markChangeGrantMock: vi.fn(),
  hasChangeGrantMock: vi.fn(),
  clearChangeGrantMock: vi.fn(),
  userHasCredentialPasswordMock: vi.fn(),
  verifyStepUpCodeMock: vi.fn(),
  clearStepUpMock: vi.fn(),
  hasStepUpFactorMock: vi.fn(),
  hasFreshStepUpMock: vi.fn(),
  markVerifiedSessionMock: vi.fn(),
  grantAdminElevationMock: vi.fn(),
  consumeTotpCodeMock: vi.fn(),
  sendEmailMock: vi.fn(),
  enableTwoFactorMock: vi.fn(),
  verifyTotpMock: vi.fn(),
  disableTwoFactorMock: vi.fn(),
  generateBackupCodesMock: vi.fn(),
  listPasskeysMock: vi.fn(),
  deletePasskeyMock: vi.fn(),
  otpConsumeMock: vi.fn(),
  stepUpConsumeMock: vi.fn(),
  cookiesSetMock: vi.fn(),
}));

vi.mock("@nojv/db", () => new Proxy({}, { get: () => ({}) }));

vi.mock("$lib/server/env", () => ({ getWebEnv: () => ({ NODE_ENV: "test" }) }));

vi.mock("@nojv/application", () => ({
  isTwoFactorActivated: isTwoFactorActivatedMock,
  setTwoFactorActivated: setTwoFactorActivatedMock,
  generateActivationOtp: generateActivationOtpMock,
  storeActivationOtp: storeActivationOtpMock,
  verifyActivationOtp: verifyActivationOtpMock,
  markTwoFactorChangeGrant: markChangeGrantMock,
  hasTwoFactorChangeGrant: hasChangeGrantMock,
  clearTwoFactorChangeGrant: clearChangeGrantMock,
  consumeTotpCode: consumeTotpCodeMock,
  securityGenerationProof: (user: { id: string; securityGeneration: number }) => ({
    userId: user.id,
    securityGeneration: user.securityGeneration,
  }),
}));

vi.mock("$lib/server/step-up", () => ({
  adminElevationPrincipal: (user: { id: string; securityGeneration: number }) => ({
    userId: user.id,
    securityGeneration: user.securityGeneration,
  }),
  grantAdminElevation: grantAdminElevationMock,
  isTwoFactorActivated: isTwoFactorActivatedMock,
  markVerifiedSession: markVerifiedSessionMock,
  securityGenerationProof: (user: { id: string; securityGeneration: number }) => ({
    userId: user.id,
    securityGeneration: user.securityGeneration,
  }),
  validateStepUpCode: (code: string) => /^\d{6}$/.test(code),
  userHasCredentialPassword: userHasCredentialPasswordMock,
  verifyStepUpCode: verifyStepUpCodeMock,
  clearStepUp: clearStepUpMock,
  hasStepUpFactor: hasStepUpFactorMock,
  hasFreshStepUp: hasFreshStepUpMock,
}));

vi.mock("@nojv/mailer", async (importActual) => ({
  ...(await importActual<typeof import("@nojv/mailer")>()),
  getMailer: () => ({ sendEmail: sendEmailMock }),
}));

vi.mock("$lib/auth.server", () => ({
  getAuth: () => ({
    api: {
      enableTwoFactor: enableTwoFactorMock,
      verifyTOTP: verifyTotpMock,
      disableTwoFactor: disableTwoFactorMock,
      generateBackupCodes: generateBackupCodesMock,
      listPasskeys: listPasskeysMock,
      deletePasskey: deletePasskeyMock,
    },
  }),
}));

vi.mock("$lib/server/shared/rate-limiter", () => ({
  otpSendRateLimiter: { consume: otpConsumeMock },
  stepUpAttemptRateLimiter: { consume: stepUpConsumeMock },
}));

import {
  twoFactorActions as actions,
  loadTwoFactor as load,
} from "$lib/../routes/(app)/settings/two-factor-actions";
import { actions as verifyActions } from "$lib/../routes/(app)/account/api-tokens/verify/+page.server";

function makeEvent(opts?: {
  twoFactorEnabled?: boolean;
  isSuperAdmin?: boolean;
  body?: FormData;
  returnTo?: string;
}): RequestEvent {
  const url = new URL("http://localhost/settings");
  if (opts?.returnTo) url.searchParams.set("returnTo", opts.returnTo);
  return {
    locals: {
      user: { id: "usr_1" },
      session: { id: "sess_1", createdAt: new Date() },
      sessionUser: {
        id: "usr_1",
        username: "alice",
        name: "Alice",
        email: "a@example.com",
        emailVerified: true,
        platformRole: opts?.isSuperAdmin ? "admin" : "student",
        isSuperAdmin: opts?.isSuperAdmin ?? false,
        twoFactorEnabled: opts?.twoFactorEnabled ?? false,
        twoFactorActivated: true,
        disabled: false,
        mustChangePassword: false,
        securityGeneration: 7,
      },
      apiTokenActor: null,
    },
    request: new Request("http://localhost/settings", {
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
  isTwoFactorActivatedMock.mockReset().mockResolvedValue(false);
  setTwoFactorActivatedMock.mockReset().mockResolvedValue({
    userId: "usr_1",
    securityGeneration: 8,
  });
  generateActivationOtpMock.mockReset().mockReturnValue("123456");
  storeActivationOtpMock.mockReset().mockResolvedValue(undefined);
  verifyActivationOtpMock.mockReset();
  markChangeGrantMock.mockReset().mockResolvedValue(true);
  hasChangeGrantMock.mockReset().mockResolvedValue(false);
  clearChangeGrantMock.mockReset().mockResolvedValue(undefined);
  userHasCredentialPasswordMock.mockReset().mockResolvedValue(false);
  verifyStepUpCodeMock.mockReset();
  clearStepUpMock.mockReset().mockResolvedValue(undefined);
  hasStepUpFactorMock.mockReset().mockResolvedValue(false);
  hasFreshStepUpMock.mockReset().mockResolvedValue(false);
  markVerifiedSessionMock.mockReset().mockResolvedValue(true);
  grantAdminElevationMock.mockReset().mockResolvedValue(true);
  consumeTotpCodeMock.mockReset().mockResolvedValue(true);
  sendEmailMock.mockReset().mockResolvedValue(undefined);
  enableTwoFactorMock.mockReset();
  verifyTotpMock.mockReset();
  disableTwoFactorMock.mockReset();
  generateBackupCodesMock.mockReset();
  listPasskeysMock.mockReset().mockResolvedValue([]);
  deletePasskeyMock.mockReset().mockResolvedValue(undefined);
  otpConsumeMock.mockReset().mockResolvedValue(undefined);
  stepUpConsumeMock.mockReset().mockResolvedValue(undefined);
  cookiesSetMock.mockReset();
});

describe("loadTwoFactor", () => {
  it("reports the master switch state and sanitizes returnTo", async () => {
    isTwoFactorActivatedMock.mockResolvedValue(true);
    const ok = await load(makeEvent({ returnTo: "/account/api-tokens" }));
    expect(ok.twoFactorActivated).toBe(true);
    expect(ok.returnTo).toBe("/account/api-tokens");

    const evil = await load(makeEvent({ returnTo: "https://evil.test" }));
    expect(evil.returnTo).toBeNull();
  });
});

describe("sendEmailOtp", () => {
  it("refuses when already activated and a device factor exists", async () => {
    isTwoFactorActivatedMock.mockResolvedValue(true);
    const result = await actions.sendEmailOtp(makeEvent({ twoFactorEnabled: true }));
    expect(result).toMatchObject({ status: 400 });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("fails 429 when the send rate limit is exceeded", async () => {
    otpConsumeMock.mockRejectedValue(new Error("rate limited"));
    const result = await actions.sendEmailOtp(makeEvent());
    expect(result).toMatchObject({ status: 429 });
    expect(storeActivationOtpMock).not.toHaveBeenCalled();
  });

  it("stores the OTP and emails the code (turn-on)", async () => {
    const result = await actions.sendEmailOtp(makeEvent());
    expect(storeActivationOtpMock).toHaveBeenCalledWith("usr_1", "123456");
    expect(sendEmailMock).toHaveBeenCalledOnce();
    const sent = sendEmailMock.mock.calls[0][0];
    expect(sent).toMatchObject({ to: "a@example.com" });
    expect(sent.html).toContain("123456");
    expect(result).toEqual({ sent: true });
  });

  it("allows sending when activated but no device factor exists (step-up fallback)", async () => {
    isTwoFactorActivatedMock.mockResolvedValue(true);
    const result = await actions.sendEmailOtp(makeEvent({ twoFactorEnabled: false }));
    expect(result).toEqual({ sent: true });
    expect(sendEmailMock).toHaveBeenCalledOnce();
  });
});

describe("activate", () => {
  it("fails 400 when already activated", async () => {
    isTwoFactorActivatedMock.mockResolvedValue(true);
    const result = await actions.activate(makeEvent({ body: form({ otp: "123456" }) }));
    expect(result).toMatchObject({ status: 400 });
    expect(setTwoFactorActivatedMock).not.toHaveBeenCalled();
  });

  it("fails 401 on an invalid OTP", async () => {
    verifyActivationOtpMock.mockResolvedValue({ ok: false, reason: "invalid" });
    const result = await actions.activate(makeEvent({ body: form({ otp: "000000" }) }));
    expect(result).toMatchObject({ status: 401 });
    expect(setTwoFactorActivatedMock).not.toHaveBeenCalled();
  });

  it("fails 400 on an expired OTP", async () => {
    verifyActivationOtpMock.mockResolvedValue({ ok: false, reason: "expired" });
    const result = await actions.activate(makeEvent({ body: form({ otp: "123456" }) }));
    expect(result).toMatchObject({ status: 400 });
  });

  it("activates, grants a change window, and emails on success", async () => {
    verifyActivationOtpMock.mockResolvedValue({ ok: true });
    const result = await actions.activate(makeEvent({ body: form({ otp: "123456" }) }));
    expect(setTwoFactorActivatedMock).toHaveBeenCalledWith("usr_1", true);
    expect(markChangeGrantMock).toHaveBeenCalledWith("sess_1", {
      userId: "usr_1",
      securityGeneration: 8,
    });
    expect(sendEmailMock).toHaveBeenCalledOnce();
    expect(result).toEqual({ activated: true });
  });
});

describe("deactivate", () => {
  it("fails 400 when not activated", async () => {
    isTwoFactorActivatedMock.mockResolvedValue(false);
    const result = await actions.deactivate(makeEvent({ body: form({ code: "123456" }) }));
    expect(result).toMatchObject({ status: 400 });
  });

  it("turns off with a valid device code and keeps the factors", async () => {
    isTwoFactorActivatedMock.mockResolvedValue(true);
    hasStepUpFactorMock.mockResolvedValue(true);
    verifyStepUpCodeMock.mockResolvedValue({ ok: true });
    const result = await actions.deactivate(
      makeEvent({ twoFactorEnabled: true, body: form({ code: "123456" }) }),
    );
    expect(verifyStepUpCodeMock).toHaveBeenCalledWith(
      { userId: "usr_1", securityGeneration: 7 },
      "123456",
      expect.any(Headers),
      true,
    );
    expect(setTwoFactorActivatedMock).toHaveBeenCalledWith("usr_1", false);
    expect(clearStepUpMock).toHaveBeenCalledWith("sess_1");
    expect(clearChangeGrantMock).toHaveBeenCalledWith("sess_1");
    expect(result).toEqual({ deactivated: true });
  });

  it("fails 401 on a bad device code", async () => {
    isTwoFactorActivatedMock.mockResolvedValue(true);
    hasStepUpFactorMock.mockResolvedValue(true);
    verifyStepUpCodeMock.mockResolvedValue({ ok: false, reason: "invalid" });
    const result = await actions.deactivate(
      makeEvent({ twoFactorEnabled: true, body: form({ code: "000000" }) }),
    );
    expect(result).toMatchObject({ status: 401 });
    expect(setTwoFactorActivatedMock).not.toHaveBeenCalled();
  });

  it("falls back to email OTP when the user has no device factor", async () => {
    isTwoFactorActivatedMock.mockResolvedValue(true);
    hasStepUpFactorMock.mockResolvedValue(false);
    verifyActivationOtpMock.mockResolvedValue({ ok: true });
    const result = await actions.deactivate(makeEvent({ body: form({ otp: "123456" }) }));
    expect(verifyActivationOtpMock).toHaveBeenCalledWith("usr_1", "123456");
    expect(setTwoFactorActivatedMock).toHaveBeenCalledWith("usr_1", false);
    expect(result).toEqual({ deactivated: true });
  });

  it("returns needsStepUp when a device factor exists but no proof is supplied", async () => {
    isTwoFactorActivatedMock.mockResolvedValue(true);
    hasStepUpFactorMock.mockResolvedValue(true);
    const result = await actions.deactivate(makeEvent({ twoFactorEnabled: true }));
    expect(result).toMatchObject({ status: 403, data: { needsStepUp: true } });
  });

  it("does not accept an activation change grant (grant is only for adding methods)", async () => {
    isTwoFactorActivatedMock.mockResolvedValue(true);
    hasChangeGrantMock.mockResolvedValue(true);
    hasStepUpFactorMock.mockResolvedValue(false);
    // no otp supplied → falls through to needsStepUp despite the grant
    const result = await actions.deactivate(makeEvent({ body: form({}) }));
    expect(result).toMatchObject({ status: 403, data: { needsStepUp: true } });
    expect(setTwoFactorActivatedMock).not.toHaveBeenCalled();
  });

  it("fails 429 when the step-up attempt rate limit is exceeded", async () => {
    isTwoFactorActivatedMock.mockResolvedValue(true);
    stepUpConsumeMock.mockRejectedValue(new Error("rate limited"));
    const result = await actions.deactivate(
      makeEvent({ twoFactorEnabled: true, body: form({ code: "123456" }) }),
    );
    expect(result).toMatchObject({ status: 429 });
  });
});

describe("enable (add TOTP)", () => {
  it("fails 400 needsActivation when the master switch is off", async () => {
    isTwoFactorActivatedMock.mockResolvedValue(false);
    const result = await actions.enable(makeEvent({ body: form({}) }));
    expect(result).toMatchObject({ status: 400, data: { needsActivation: true } });
    expect(enableTwoFactorMock).not.toHaveBeenCalled();
  });

  it("password user with an activation grant: passes the password to enableTwoFactor", async () => {
    isTwoFactorActivatedMock.mockResolvedValue(true);
    hasChangeGrantMock.mockResolvedValue(true);
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
    expect(result).toMatchObject({ totpURI: "otpauth://totp/NOJV:a?secret=ABC" });
  });

  it("password alone is not a step-up: no grant/device/otp returns needsStepUp", async () => {
    isTwoFactorActivatedMock.mockResolvedValue(true);
    userHasCredentialPasswordMock.mockResolvedValue(true);
    const result = await actions.enable(makeEvent({ body: form({ password: "hunter2" }) }));
    expect(result).toMatchObject({ status: 403, data: { needsStepUp: true } });
    expect(enableTwoFactorMock).not.toHaveBeenCalled();
  });

  it("passwordless user with a recent activation grant: enables with an empty body", async () => {
    isTwoFactorActivatedMock.mockResolvedValue(true);
    hasChangeGrantMock.mockResolvedValue(true);
    enableTwoFactorMock.mockResolvedValue({
      totpURI: "otpauth://totp/NOJV:a?secret=ABC",
      backupCodes: ["aaaaa-bbbbb"],
    });
    const result = await actions.enable(makeEvent({ body: form({}) }));
    expect(enableTwoFactorMock).toHaveBeenCalledWith({
      body: {},
      headers: expect.any(Headers),
    });
    expect(result).toMatchObject({ totpURI: "otpauth://totp/NOJV:a?secret=ABC" });
  });

  it("passwordless user without any step-up: returns needsStepUp", async () => {
    isTwoFactorActivatedMock.mockResolvedValue(true);
    const result = await actions.enable(makeEvent({ body: form({}) }));
    expect(result).toMatchObject({ status: 403, data: { needsStepUp: true } });
    expect(enableTwoFactorMock).not.toHaveBeenCalled();
  });
});

describe("verify", () => {
  it("rejects malformed enrollment codes without creating a reservation", async () => {
    const result = await actions.verify(makeEvent({ body: form({ code: "not-a-code" }) }));

    expect(result).toMatchObject({ status: 400 });
    expect(consumeTotpCodeMock).not.toHaveBeenCalled();
    expect(verifyTotpMock).not.toHaveBeenCalled();
  });

  it("fails 401 when verifyTOTP throws", async () => {
    let reservedBeforeVerification = false;
    consumeTotpCodeMock.mockImplementation(async () => {
      reservedBeforeVerification = true;
      return true;
    });
    verifyTotpMock.mockRejectedValue(new Error("invalid"));
    const result = await actions.verify(makeEvent({ body: form({ code: "000000" }) }));
    expect(result).toMatchObject({ status: 401 });
    expect(reservedBeforeVerification).toBe(true);
    expect(consumeTotpCodeMock).toHaveBeenCalledOnce();
  });

  it("fails closed without mutation when the reservation store is unavailable", async () => {
    consumeTotpCodeMock.mockRejectedValue(new Error("redis unavailable"));

    const result = await actions.verify(makeEvent({ body: form({ code: "123456" }) }));

    expect(result).toMatchObject({ status: 503 });
    expect(verifyTotpMock).not.toHaveBeenCalled();
    expect(cookiesSetMock).not.toHaveBeenCalled();
  });

  it("reserves enrollment before mutation and blocks an interleaved privileged action", async () => {
    let enterVerification!: () => void;
    let releaseVerification!: () => void;
    const entered = new Promise<void>((resolve) => {
      enterVerification = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseVerification = resolve;
    });
    verifyTotpMock.mockImplementation(async () => {
      enterVerification();
      await release;
      return { headers: new Headers({ "set-cookie": "session=rotated; Path=/; HttpOnly" }) };
    });
    verifyStepUpCodeMock.mockImplementation(
      async (_proof, _code, _headers, twoFactorEnabled: boolean) =>
        twoFactorEnabled ? { ok: true } : { ok: false, reason: "factor_unavailable" as const },
    );

    const enrollmentEvent = makeEvent({ body: form({ code: "123456" }) });
    const enrollment = actions.verify(enrollmentEvent);
    await entered;
    const reservedBeforeMutation = consumeTotpCodeMock.mock.calls.length === 1;

    const privilegedEvent = makeEvent({ body: form({ code: "123456" }) });
    const privileged = await verifyActions.default(privilegedEvent);

    releaseVerification();
    await expect(enrollment).resolves.toEqual({ enabled: true });
    expect(reservedBeforeMutation).toBe(true);
    expect(verifyStepUpCodeMock).toHaveBeenCalledWith(
      { userId: "usr_1", securityGeneration: 7 },
      "123456",
      expect.any(Headers),
      false,
    );
    expect(privileged).toMatchObject({ status: 403 });
    expect(markVerifiedSessionMock).not.toHaveBeenCalled();
    expect(privilegedEvent.locals.session?.id).toBe("sess_1");
  });

  it("returns enabled without converting enrollment into a privileged handoff", async () => {
    verifyTotpMock.mockResolvedValue({ headers: new Headers() });
    const result = await actions.verify(
      makeEvent({ isSuperAdmin: true, body: form({ code: "123456" }) }),
    );
    expect(consumeTotpCodeMock).toHaveBeenCalledWith("usr_1", "123456");
    expect(cookiesSetMock).not.toHaveBeenCalled();
    expect(result).toEqual({ enabled: true });
  });

  it("rejects an enrollment code already consumed by a concurrent request", async () => {
    verifyTotpMock.mockResolvedValue({ headers: new Headers() });
    consumeTotpCodeMock.mockResolvedValue(false);

    const result = await actions.verify(makeEvent({ body: form({ code: "123456" }) }));

    expect(result).toMatchObject({
      status: 401,
      data: { error: expect.stringMatching(/used/) },
    });
    expect(verifyTotpMock).not.toHaveBeenCalled();
    expect(cookiesSetMock).not.toHaveBeenCalled();
  });

  it("redirects to a sanitized returnTo after success", async () => {
    verifyTotpMock.mockResolvedValue({ headers: new Headers() });
    const body = form({ code: "123456", returnTo: "/account/api-tokens" });
    const thrown = await caught(() => actions.verify(makeEvent({ body })));
    expect(thrown.status).toBe(303);
    expect(thrown.location).toBe("/account/api-tokens");
  });
});

describe("disable (remove TOTP)", () => {
  it("fails 400 when 2FA is not enabled", async () => {
    const result = await actions.disable(makeEvent({ twoFactorEnabled: false }));
    expect(result).toMatchObject({ status: 400 });
    expect(disableTwoFactorMock).not.toHaveBeenCalled();
  });

  it("password user: requires a device code AND passes the password to disableTwoFactor", async () => {
    userHasCredentialPasswordMock.mockResolvedValue(true);
    hasStepUpFactorMock.mockResolvedValue(true);
    verifyStepUpCodeMock.mockResolvedValue({ ok: true });
    disableTwoFactorMock.mockResolvedValue({ headers: new Headers() });
    const result = await actions.disable(
      makeEvent({
        twoFactorEnabled: true,
        body: form({ password: "hunter2", code: "123456" }),
      }),
    );
    expect(verifyStepUpCodeMock).toHaveBeenCalledWith(
      { userId: "usr_1", securityGeneration: 7 },
      "123456",
      expect.any(Headers),
      true,
    );
    expect(disableTwoFactorMock).toHaveBeenCalledWith({
      body: { password: "hunter2" },
      headers: expect.any(Headers),
      returnHeaders: true,
    });
    expect(clearStepUpMock).toHaveBeenCalledWith("sess_1");
    expect(result).toEqual({ disabled: true });
  });

  it("password user without a device code: returns needsStepUp (password alone is insufficient)", async () => {
    userHasCredentialPasswordMock.mockResolvedValue(true);
    hasStepUpFactorMock.mockResolvedValue(true);
    const result = await actions.disable(
      makeEvent({ twoFactorEnabled: true, body: form({ password: "hunter2" }) }),
    );
    expect(result).toMatchObject({ status: 403, data: { needsStepUp: true } });
    expect(disableTwoFactorMock).not.toHaveBeenCalled();
  });

  it("passwordless user: verifies a device code then disables", async () => {
    hasStepUpFactorMock.mockResolvedValue(true);
    verifyStepUpCodeMock.mockResolvedValue({ ok: true });
    disableTwoFactorMock.mockResolvedValue({ headers: new Headers() });
    const result = await actions.disable(
      makeEvent({ twoFactorEnabled: true, body: form({ code: "123456" }) }),
    );
    expect(disableTwoFactorMock).toHaveBeenCalledWith({
      body: {},
      headers: expect.any(Headers),
      returnHeaders: true,
    });
    expect(result).toEqual({ disabled: true });
  });
});

describe("regenerate", () => {
  it("password user: requires a device code AND the password, returns fresh backup codes", async () => {
    userHasCredentialPasswordMock.mockResolvedValue(true);
    hasStepUpFactorMock.mockResolvedValue(true);
    verifyStepUpCodeMock.mockResolvedValue({ ok: true });
    generateBackupCodesMock.mockResolvedValue({ status: true, backupCodes: ["11111-22222"] });
    const result = await actions.regenerate(
      makeEvent({
        twoFactorEnabled: true,
        body: form({ password: "hunter2", code: "123456" }),
      }),
    );
    expect(generateBackupCodesMock).toHaveBeenCalledWith({
      body: { password: "hunter2" },
      headers: expect.any(Headers),
    });
    expect(result).toEqual({ backupCodes: ["11111-22222"] });
  });

  it("fails 400 when 2FA is not enabled", async () => {
    const result = await actions.regenerate(makeEvent({ twoFactorEnabled: false }));
    expect(result).toMatchObject({ status: 400 });
    expect(generateBackupCodesMock).not.toHaveBeenCalled();
  });
});

describe("deletePasskey", () => {
  it("fails 400 without an id", async () => {
    const result = await actions.deletePasskey(makeEvent({ body: form({}) }));
    expect(result).toMatchObject({ status: 400 });
    expect(deletePasskeyMock).not.toHaveBeenCalled();
  });

  it("returns needsStepUp when a device factor exists but no proof is supplied", async () => {
    hasStepUpFactorMock.mockResolvedValue(true);
    const result = await actions.deletePasskey(makeEvent({ body: form({ id: "pk_1" }) }));
    expect(result).toMatchObject({ status: 403, data: { needsStepUp: true } });
    expect(deletePasskeyMock).not.toHaveBeenCalled();
  });

  it("deletes with a fresh passkey step-up marker", async () => {
    hasStepUpFactorMock.mockResolvedValue(true);
    hasFreshStepUpMock.mockResolvedValue(true);
    const result = await actions.deletePasskey(makeEvent({ body: form({ id: "pk_1" }) }));
    expect(deletePasskeyMock).toHaveBeenCalledWith({
      body: { id: "pk_1" },
      headers: expect.any(Headers),
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(result).toEqual({ deletedPasskey: true });
  });
});
