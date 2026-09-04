import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  areUnlocked: vi.fn(),
  clearProofs: vi.fn(),
  confirmPendingTotp: vi.fn(),
  deletePasskey: vi.fn(),
  generateBackupCodes: vi.fn(),
  generateOtp: vi.fn(),
  getState: vi.fn(),
  listPasskeys: vi.fn(),
  markFactorChange: vi.fn(),
  markVerified: vi.fn(),
  otpLimit: vi.fn(),
  rebindSecurity: vi.fn(),
  rebindVerified: vi.fn(),
  removeTotp: vi.fn(),
  replaceBackupCodes: vi.fn(),
  sendEmail: vi.fn(),
  startPendingTotp: vi.fn(),
  stepUpLimit: vi.fn(),
  storeOtp: vi.fn(),
  unlock: vi.fn(),
  userHasPassword: vi.fn(),
  verifySetupOtp: vi.fn(),
  verifyStepUp: vi.fn(),
}));

vi.mock("@nojv/application", () => ({
  adminMfaKind: (user: { isSuperAdmin: boolean; platformRole: string }) =>
    user.platformRole !== "admin" ? "none" : user.isSuperAdmin ? "super" : "regular",
  areSecuritySettingsUnlocked: mocks.areUnlocked,
  generateSecuritySetupOtp: mocks.generateOtp,
  getSecurityFactorState: mocks.getState,
  markFactorChangeVerifiedSession: mocks.markFactorChange,
  markVerifiedSession: mocks.markVerified,
  removePasskeySecurityFactor: mocks.deletePasskey,
  removeTotpSecurityFactor: mocks.removeTotp,
  rebindSecuritySettingsAfterSecurityChange: mocks.rebindSecurity,
  rebindVerifiedSessionAfterSecurityChange: mocks.rebindVerified,
  replaceBackupCodes: mocks.replaceBackupCodes,
  securityGenerationProof: (user: { id: string; securityGeneration: number }) => ({
    securityGeneration: user.securityGeneration,
    userId: user.id,
  }),
  storeSecuritySetupOtp: mocks.storeOtp,
  unlockSecuritySettings: mocks.unlock,
  verifySecuritySetupOtp: mocks.verifySetupOtp,
}));

vi.mock("@nojv/mailer", () => ({
  getMailer: () => ({ sendEmail: mocks.sendEmail }),
  renderEmail: ({ heading, intro, outro }: Record<string, string>) => heading + intro + outro,
}));

vi.mock("$lib/auth.server", () => ({
  getAuth: () => ({ api: { listPasskeys: mocks.listPasskeys } }),
}));

vi.mock("$lib/server/env", () => ({ getWebEnv: () => ({ NODE_ENV: "production" }) }));
vi.mock("$lib/server/logger", () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));
vi.mock("$lib/server/shared/rate-limiter", () => ({
  otpSendRateLimiter: { consume: mocks.otpLimit },
  stepUpAttemptRateLimiter: { consume: mocks.stepUpLimit },
}));
vi.mock("$lib/server/step-up", () => ({
  clearVerifiedSessionProofs: mocks.clearProofs,
  userHasCredentialPassword: mocks.userHasPassword,
  validateStepUpCode: (code: string) => /^\d{6}$/.test(code),
  verifyStepUpCode: mocks.verifyStepUp,
}));
vi.mock("$lib/server/totp-enrollment", () => ({
  confirmPendingTotp: mocks.confirmPendingTotp,
  generateNewBackupCodes: mocks.generateBackupCodes,
  startPendingTotp: mocks.startPendingTotp,
}));

import {
  loadTwoFactor as load,
  twoFactorActions as actions,
} from "$lib/../routes/(app)/settings/two-factor-actions";

const state = {
  hasPasskey: false,
  hasSecurityFactor: false,
  hasTotp: false,
  isSuperAdmin: false,
  securityGeneration: 7,
};

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function event(
  options: {
    body?: FormData;
    isSuperAdmin?: boolean;
    returnTo?: string;
  } = {},
): RequestEvent {
  const url = new URL("http://localhost/settings");
  if (options.returnTo) url.searchParams.set("returnTo", options.returnTo);
  return {
    cookies: {},
    locals: {
      apiTokenActor: null,
      session: { createdAt: new Date(), id: "sess_1" },
      sessionUser: {
        disabled: false,
        email: "a@example.com",
        emailVerified: true,
        id: "usr_1",
        isSuperAdmin: options.isSuperAdmin ?? false,
        mustChangePassword: false,
        name: "Alice",
        platformRole: options.isSuperAdmin ? "admin" : "student",
        securityGeneration: 7,
        twoFactorEnabled: false,
        username: "alice",
      },
      user: { email: "a@example.com", id: "usr_1" },
    },
    request: new Request(url, { body: options.body ?? new FormData(), method: "POST" }),
    url,
  } as unknown as RequestEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.areUnlocked.mockResolvedValue(false);
  mocks.clearProofs.mockResolvedValue(undefined);
  mocks.generateBackupCodes.mockResolvedValue({
    backupCodes: ["backup-1"],
    encryptedBackupCodes: "encrypted",
  });
  mocks.generateOtp.mockReturnValue("123456");
  mocks.getState.mockResolvedValue(state);
  mocks.listPasskeys.mockResolvedValue([]);
  mocks.markVerified.mockResolvedValue(true);
  mocks.markFactorChange.mockResolvedValue(true);
  mocks.otpLimit.mockResolvedValue("allowed");
  mocks.rebindSecurity.mockResolvedValue(true);
  mocks.rebindVerified.mockResolvedValue(true);
  mocks.sendEmail.mockResolvedValue("accepted");
  mocks.stepUpLimit.mockResolvedValue("allowed");
  mocks.unlock.mockResolvedValue(true);
  mocks.userHasPassword.mockResolvedValue(true);
});

describe("login and security settings", () => {
  it("derives setup state from factors and sanitizes returnTo", async () => {
    mocks.getState.mockResolvedValue({
      ...state,
      hasPasskey: true,
      hasSecurityFactor: true,
      isSuperAdmin: true,
    });
    mocks.listPasskeys.mockResolvedValue([{ createdAt: new Date(), id: "pk_1", name: null }]);
    const result = await load(event({ isSuperAdmin: true, returnTo: "/admin" }));
    expect(result).toMatchObject({
      canRemoveLastFactor: false,
      hasSecurityFactor: true,
      returnTo: "/admin",
    });
    expect(result.passkeys[0]).toMatchObject({ canRemove: false, id: "pk_1" });
    expect((await load(event({ returnTo: "https://evil.test" }))).returnTo).toBeNull();
    expect((await load(event({ returnTo: "/\\evil.test" }))).returnTo).toBeNull();
  });

  it("uses email OTP only when no factor exists", async () => {
    await expect(actions.sendSecuritySetupOtp(event())).resolves.toEqual({ sent: true });
    expect(mocks.storeOtp).toHaveBeenCalledWith("usr_1", "123456");
    expect(mocks.sendEmail).toHaveBeenCalledOnce();

    mocks.getState.mockResolvedValue({ ...state, hasSecurityFactor: true, hasTotp: true });
    await expect(actions.sendSecuritySetupOtp(event())).resolves.toMatchObject({ status: 400 });
  });

  it("fails closed when OTP limiting or delivery is unavailable", async () => {
    mocks.otpLimit.mockResolvedValueOnce("unavailable");
    await expect(actions.sendSecuritySetupOtp(event())).resolves.toMatchObject({ status: 503 });

    mocks.sendEmail.mockResolvedValueOnce("suppressed");
    await expect(actions.sendSecuritySetupOtp(event())).resolves.toMatchObject({ status: 503 });
  });

  it("unlocks first-factor setup with email OTP", async () => {
    mocks.verifySetupOtp.mockResolvedValue({ ok: true });
    await expect(
      actions.unlockSecuritySettings(event({ body: form({ otp: "123456" }) })),
    ).resolves.toEqual({ unlocked: true });
    expect(mocks.unlock).toHaveBeenCalledWith("sess_1", {
      securityGeneration: 7,
      userId: "usr_1",
    });
    expect(mocks.verifyStepUp).not.toHaveBeenCalled();
  });

  it("unlocks existing-factor settings with TOTP and creates one shared proof", async () => {
    mocks.getState.mockResolvedValue({ ...state, hasSecurityFactor: true, hasTotp: true });
    mocks.verifyStepUp.mockResolvedValue({ ok: true });
    await expect(
      actions.unlockSecuritySettings(event({ body: form({ code: "123456" }) })),
    ).resolves.toEqual({ unlocked: true });
    expect(mocks.markVerified).toHaveBeenCalledWith(
      "sess_1",
      { securityGeneration: 7, userId: "usr_1" },
      "none",
    );
  });

  it("requires the generation-bound unlock before starting TOTP setup", async () => {
    await expect(actions.beginTotpSetup(event())).resolves.toMatchObject({
      data: { needsStepUp: true },
      status: 403,
    });
    expect(mocks.startPendingTotp).not.toHaveBeenCalled();
  });

  it("confirms only the new authenticator code and binds the new generation", async () => {
    mocks.areUnlocked.mockResolvedValue(true);
    mocks.confirmPendingTotp.mockResolvedValue({
      ok: true,
      state: { ...state, hasSecurityFactor: true, hasTotp: true, securityGeneration: 8 },
    });
    await expect(
      actions.confirmTotpSetup(event({ body: form({ code: "123456" }) })),
    ).resolves.toEqual({ enabled: true });
    expect(mocks.confirmPendingTotp).toHaveBeenCalledWith(
      "sess_1",
      { securityGeneration: 7, userId: "usr_1" },
      "123456",
    );
    expect(mocks.markFactorChange).toHaveBeenCalledWith(
      "sess_1",
      { securityGeneration: 7, userId: "usr_1" },
      { securityGeneration: 8, userId: "usr_1" },
      "none",
    );
  });

  it("keeps a super admin's final factor", async () => {
    mocks.areUnlocked.mockResolvedValue(true);
    mocks.removeTotp.mockResolvedValue({ outcome: "last_super_admin_factor" });
    await expect(actions.removeTotp(event({ isSuperAdmin: true }))).resolves.toMatchObject({
      status: 403,
    });
    expect(mocks.rebindVerified).not.toHaveBeenCalled();
  });

  it("rejects an unlock bound to an older security generation", async () => {
    mocks.areUnlocked.mockResolvedValue(true);
    mocks.getState.mockResolvedValue({ ...state, securityGeneration: 8 });
    await expect(actions.removeTotp(event())).resolves.toMatchObject({
      data: { needsStepUp: true },
      status: 403,
    });
    expect(mocks.removeTotp).not.toHaveBeenCalled();
  });

  it("regenerates backup codes inside the existing unlock window", async () => {
    mocks.areUnlocked.mockResolvedValue(true);
    mocks.getState.mockResolvedValue({ ...state, hasSecurityFactor: true, hasTotp: true });
    mocks.replaceBackupCodes.mockResolvedValue({
      ...state,
      hasSecurityFactor: true,
      hasTotp: true,
      securityGeneration: 8,
    });
    await expect(actions.regenerateBackupCodes(event())).resolves.toEqual({
      backupCodes: ["backup-1"],
    });
    expect(mocks.replaceBackupCodes).toHaveBeenCalledWith("usr_1", "encrypted", 7);
    expect(mocks.rebindVerified).toHaveBeenCalledOnce();
  });
});
