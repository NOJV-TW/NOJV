import {
  areSecuritySettingsUnlocked,
  adminMfaKind,
  generateSecuritySetupOtp,
  getSecurityFactorState,
  markFactorChangeVerifiedSession,
  markVerifiedSession,
  removePasskeySecurityFactor,
  removeTotpSecurityFactor,
  rebindSecuritySettingsAfterSecurityChange,
  rebindVerifiedSessionAfterSecurityChange,
  replaceBackupCodes,
  securityGenerationProof,
  storeSecuritySetupOtp,
  unlockSecuritySettings,
  verifySecuritySetupOtp,
  type SecurityFactorState,
  type SecurityGenerationProof,
} from "@nojv/application";
import { getMailer, renderEmail } from "@nojv/mailer";
import { fail, redirect } from "@sveltejs/kit";
import type { Actions, RequestEvent } from "@sveltejs/kit";

import { getAuth } from "$lib/auth.server";
import { requireAuth } from "$lib/server/auth";
import { getWebEnv } from "$lib/server/env";
import { createLogger } from "$lib/server/logger";
import {
  otpSendRateLimiter,
  stepUpAttemptRateLimiter,
  type RateLimitResult,
} from "$lib/server/shared/rate-limiter";
import {
  clearVerifiedSessionProofs,
  userHasCredentialPassword,
  validateStepUpCode,
  verifyStepUpCode,
} from "$lib/server/step-up";
import {
  confirmPendingTotp,
  generateNewBackupCodes,
  startPendingTotp,
} from "$lib/server/totp-enrollment";

const logger = createLogger("security-settings");

function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return (typeof value === "string" ? value : "").trim();
}

function sanitizeReturnTo(value: string | null): string | null {
  return value?.startsWith("/") && !value.startsWith("//") && !value.includes("\\")
    ? value
    : null;
}

function setupOtpEmailHtml(code: string): string {
  return renderEmail({
    heading: "登入與安全驗證碼 · Login and security code",
    intro: `<p>請在 NOJV 輸入以下驗證碼，開始設定第一個安全驗證方式。</p><p>Enter this code on NOJV to set up your first security factor.</p><p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:20px 0">${code}</p>`,
    outro:
      "此驗證碼 10 分鐘內有效，且僅能使用一次。若你未要求此驗證碼，請忽略這封信。<br>This code is valid for 10 minutes and can be used once. If you did not request it, ignore this email.",
  });
}

const STEP_UP_FAIL_MESSAGE = {
  factor_unavailable: "This authenticator is not available.",
  malformed: "Enter the 6-digit code from your authenticator.",
  replayed: "That code was already used. Wait for a new code.",
  invalid: "Invalid code. Try again.",
  stale: "Your security settings changed. Reload and verify again.",
} as const;

const EMAIL_OTP_FAIL_MESSAGE = {
  expired: "That code has expired. Request a new one.",
  invalid: "Invalid code. Try again.",
  locked: "Too many attempts. Request a new code.",
} as const;

function rateLimitFailure(result: RateLimitResult, limitedMessage: string) {
  if (result === "allowed") return null;
  return result === "limited"
    ? fail(429, { error: limitedMessage })
    : fail(503, { error: "Rate limiter unavailable. Please try again later." });
}

async function requireSecuritySettingsUnlock(event: RequestEvent) {
  const actor = requireAuth(event);
  const sessionId = event.locals.session?.id;
  const sessionUser = event.locals.sessionUser;
  if (!sessionId || !sessionUser) {
    return {
      ok: false as const,
      response: fail(403, { error: "Session authentication is required." }),
    };
  }
  const state = await getSecurityFactorState(actor.userId);
  if (!state) {
    return { ok: false as const, response: fail(404, { error: "Account not found." }) };
  }
  const proof = securityGenerationProof(sessionUser);
  if (
    state.securityGeneration !== proof.securityGeneration ||
    !(await areSecuritySettingsUnlocked(sessionId, proof))
  ) {
    return { ok: false as const, response: fail(403, { needsStepUp: true }) };
  }
  return {
    ok: true as const,
    adminMfa: adminMfaKind(sessionUser),
    proof,
    sessionId,
    state,
  };
}

async function rebindAfterFactorChange(
  sessionId: string,
  previousProof: SecurityGenerationProof,
  state: SecurityFactorState,
): Promise<boolean> {
  const currentProof = {
    userId: previousProof.userId,
    securityGeneration: state.securityGeneration,
  };
  if (state.hasSecurityFactor) {
    return rebindVerifiedSessionAfterSecurityChange(sessionId, previousProof, currentProof);
  }
  await clearVerifiedSessionProofs(sessionId);
  return rebindSecuritySettingsAfterSecurityChange(sessionId, previousProof, currentProof);
}

export const loadTwoFactor = async (event: RequestEvent) => {
  const actor = requireAuth(event);
  const sessionId = event.locals.session?.id;
  const sessionUser = event.locals.sessionUser;
  const [passkeys, state] = await Promise.all([
    getAuth().api.listPasskeys({ headers: event.request.headers }),
    getSecurityFactorState(actor.userId),
  ]);
  if (!state) throw new Error("Authenticated account not found.");
  const securitySettingsUnlocked =
    !!sessionId &&
    !!sessionUser &&
    (await areSecuritySettingsUnlocked(sessionId, securityGenerationProof(sessionUser)));
  return {
    hasSecurityFactor: state.hasSecurityFactor,
    hasTotp: state.hasTotp,
    isSuperAdmin: state.isSuperAdmin,
    canRemoveLastFactor: !state.isSuperAdmin,
    hasPassword: await userHasCredentialPassword(actor.userId),
    returnTo: sanitizeReturnTo(event.url.searchParams.get("returnTo")),
    setupAutoOpen: event.url.searchParams.get("setupSecurity") === "1",
    securitySettingsUnlocked,
    passkeys: passkeys.map((passkey) => ({
      id: passkey.id,
      name: passkey.name ?? "Passkey",
      createdAt: passkey.createdAt,
      canRemove:
        !state.isSuperAdmin ||
        state.hasTotp ||
        passkeys.some((other) => other.id !== passkey.id),
    })),
  };
};

export const twoFactorActions = {
  sendSecuritySetupOtp: async (event) => {
    const actor = requireAuth(event);
    if ((await getSecurityFactorState(actor.userId))?.hasSecurityFactor) {
      return fail(400, {
        error: "Use your authenticator or passkey to unlock these settings.",
      });
    }
    const limited = rateLimitFailure(
      await otpSendRateLimiter.consume(actor.userId),
      "Too many requests. Please try again later.",
    );
    if (limited) return limited;
    const otp = generateSecuritySetupOtp();
    await storeSecuritySetupOtp(actor.userId, otp);
    try {
      const delivery = await getMailer().sendEmail({
        to: actor.email,
        subject: "NOJV 登入與安全驗證碼",
        html: setupOtpEmailHtml(otp),
      });
      if (delivery === "suppressed" && getWebEnv().NODE_ENV !== "test") {
        return fail(503, { error: "Email delivery is unavailable. Please try again later." });
      }
    } catch (error) {
      logger.error("Security setup OTP send failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(502, { error: "Could not send the code. Please try again." });
    }
    return getWebEnv().NODE_ENV === "development"
      ? { sent: true, devOtp: otp }
      : { sent: true };
  },

  unlockSecuritySettings: async (event) => {
    const actor = requireAuth(event);
    const sessionId = event.locals.session?.id;
    const sessionUser = event.locals.sessionUser;
    if (!sessionId || !sessionUser) {
      return fail(403, { error: "Session authentication is required." });
    }
    const proof = securityGenerationProof(sessionUser);
    if (await areSecuritySettingsUnlocked(sessionId, proof)) return { unlocked: true };
    const limited = rateLimitFailure(
      await stepUpAttemptRateLimiter.consume(actor.userId),
      "Too many attempts. Please try again later.",
    );
    if (limited) return limited;
    const state = await getSecurityFactorState(actor.userId);
    if (!state) return fail(404, { error: "Account not found." });
    const formData = await event.request.formData();
    if (state.hasSecurityFactor) {
      const result = await verifyStepUpCode(
        proof,
        formString(formData, "code"),
        event.request.headers,
        state.hasTotp,
      );
      if (!result.ok) {
        return fail(result.reason === "malformed" ? 400 : 401, {
          error: STEP_UP_FAIL_MESSAGE[result.reason],
        });
      }
      if (!(await markVerifiedSession(sessionId, proof, adminMfaKind(sessionUser)))) {
        return fail(409, { error: "Your security settings changed. Reload and verify again." });
      }
      return { unlocked: true };
    }
    const result = await verifySecuritySetupOtp(actor.userId, formString(formData, "otp"));
    if (!result.ok) {
      return fail(result.reason === "invalid" ? 401 : 400, {
        error: EMAIL_OTP_FAIL_MESSAGE[result.reason],
      });
    }
    if (!(await unlockSecuritySettings(sessionId, proof))) {
      return fail(409, { error: "Your security settings changed. Reload and verify again." });
    }
    return { unlocked: true };
  },

  beginTotpSetup: async (event) => {
    const actor = requireAuth(event);
    const authorization = await requireSecuritySettingsUnlock(event);
    if (!authorization.ok) return authorization.response;
    const result = await startPendingTotp(
      authorization.sessionId,
      authorization.proof,
      actor.email,
    );
    return (
      result ?? fail(409, { error: "Your security settings changed. Reload and try again." })
    );
  },

  confirmTotpSetup: async (event) => {
    const actor = requireAuth(event);
    const authorization = await requireSecuritySettingsUnlock(event);
    if (!authorization.ok) return authorization.response;
    const formData = await event.request.formData();
    const code = formString(formData, "code");
    if (!validateStepUpCode(code)) {
      return fail(400, { error: "Enter the 6-digit code from the new authenticator." });
    }
    const result = await confirmPendingTotp(authorization.sessionId, authorization.proof, code);
    if (!result.ok) {
      return fail(result.reason === "invalid" || result.reason === "replayed" ? 401 : 409, {
        error:
          result.reason === "invalid"
            ? "That code does not match the new authenticator. Try the current code."
            : result.reason === "replayed"
              ? "That code was already used. Wait for a new code."
              : "The setup expired or your security settings changed. Start again.",
      });
    }
    const previousProof = authorization.proof;
    const proof = { userId: actor.userId, securityGeneration: result.state.securityGeneration };
    if (
      !(await markFactorChangeVerifiedSession(
        authorization.sessionId,
        previousProof,
        proof,
        authorization.adminMfa,
      ))
    ) {
      return fail(409, { error: "The factor was saved, but this settings window expired." });
    }
    const returnTo = sanitizeReturnTo(
      formString(formData, "returnTo") || event.url.searchParams.get("returnTo"),
    );
    if (returnTo) redirect(303, returnTo);
    return { enabled: true };
  },

  removeTotp: async (event) => {
    const authorization = await requireSecuritySettingsUnlock(event);
    if (!authorization.ok) return authorization.response;
    const result = await removeTotpSecurityFactor(
      authorization.proof.userId,
      authorization.state.securityGeneration,
    );
    if (result.outcome === "stale") {
      return fail(409, { error: "Your security settings changed. Reload and verify again." });
    }
    if (result.outcome === "last_super_admin_factor") {
      return fail(403, { error: "A super admin must keep at least one security factor." });
    }
    if (result.outcome === "missing") return fail(404, { error: "Authenticator not found." });
    if (
      !(await rebindAfterFactorChange(
        authorization.sessionId,
        authorization.proof,
        result.state,
      ))
    ) {
      return fail(409, {
        error: "Your security settings changed. Reload and unlock them again.",
      });
    }
    return { removedTotp: true };
  },

  regenerateBackupCodes: async (event) => {
    const authorization = await requireSecuritySettingsUnlock(event);
    if (!authorization.ok) return authorization.response;
    if (!authorization.state.hasTotp) {
      return fail(400, { error: "Set up an authenticator before generating backup codes." });
    }
    const codes = await generateNewBackupCodes();
    const state = await replaceBackupCodes(
      authorization.proof.userId,
      codes.encryptedBackupCodes,
      authorization.state.securityGeneration,
    );
    if (!state) {
      return fail(409, { error: "Your security settings changed. Reload and verify again." });
    }
    if (!(await rebindAfterFactorChange(authorization.sessionId, authorization.proof, state))) {
      return fail(409, { error: "Backup codes changed. Reload and unlock settings again." });
    }
    return { backupCodes: codes.backupCodes };
  },

  deletePasskey: async (event) => {
    const authorization = await requireSecuritySettingsUnlock(event);
    if (!authorization.ok) return authorization.response;
    const id = formString(await event.request.formData(), "id");
    if (!id) return fail(400, { error: "Missing passkey id." });
    const result = await removePasskeySecurityFactor(
      authorization.proof.userId,
      id,
      authorization.state.securityGeneration,
    );
    if (result.outcome === "stale") {
      return fail(409, { error: "Your security settings changed. Reload and verify again." });
    }
    if (result.outcome === "last_super_admin_factor") {
      return fail(403, { error: "A super admin must keep at least one security factor." });
    }
    if (result.outcome === "missing") return fail(404, { error: "Passkey not found." });
    if (
      !(await rebindAfterFactorChange(
        authorization.sessionId,
        authorization.proof,
        result.state,
      ))
    ) {
      return fail(409, {
        error: "Your security settings changed. Reload and unlock them again.",
      });
    }
    return { deletedPasskey: true };
  },
} satisfies Actions;
