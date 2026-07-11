import {
  clearTwoFactorChangeGrant,
  generateActivationOtp,
  hasTwoFactorChangeGrant,
  isTwoFactorActivated,
  markTwoFactorChangeGrant,
  setTwoFactorActivated,
  storeActivationOtp,
  verifyActivationOtp,
} from "@nojv/application";
import { getMailer, renderEmail } from "@nojv/mailer";
import { fail, redirect } from "@sveltejs/kit";
import type { Actions, RequestEvent } from "@sveltejs/kit";

import { getAuth } from "$lib/auth.server";
import { requireAuth } from "$lib/server/auth";
import { getWebEnv } from "$lib/server/env";
import { createLogger } from "$lib/server/logger";
import { otpSendRateLimiter, stepUpAttemptRateLimiter } from "$lib/server/shared/rate-limiter";
import {
  clearStepUp,
  hasFreshStepUp,
  hasStepUpFactor,
  markAdminSessionMfa,
  userHasCredentialPassword,
  verifyStepUpCode,
} from "$lib/server/step-up";

const logger = createLogger("two-factor");

function sanitizeReturnTo(value: string | null): string | null {
  return typeof value === "string" && value.startsWith("/account/") ? value : null;
}

function forwardSetCookies(event: RequestEvent, headers: Headers): void {
  for (const raw of headers.getSetCookie()) {
    const parts = raw.split(";");
    const pair = parts[0];
    if (!pair) continue;
    const attrs = parts.slice(1);
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const options: Parameters<typeof event.cookies.set>[2] = {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      encode: (v) => v,
    };
    for (const attr of attrs) {
      const i = attr.indexOf("=");
      const key = (i < 0 ? attr : attr.slice(0, i)).trim().toLowerCase();
      const val = i < 0 ? "" : attr.slice(i + 1).trim();
      if (key === "path") options.path = val;
      else if (key === "domain") options.domain = val;
      else if (key === "max-age") options.maxAge = Number(val);
      else if (key === "expires") options.expires = new Date(val);
      else if (key === "samesite")
        options.sameSite = val.toLowerCase() as "lax" | "strict" | "none";
      else if (key === "secure") options.secure = true;
      else if (key === "httponly") options.httpOnly = true;
    }
    event.cookies.set(name, value, options);
  }
}

function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return (typeof value === "string" ? value : "").trim();
}

function otpEmailHtml(code: string): string {
  return renderEmail({
    heading: "兩步驟驗證碼 · Two-factor verification code",
    intro: `<p>請在 NOJV 頁面輸入以下驗證碼以繼續。</p><p>Enter this code on NOJV to continue.</p><p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:20px 0">${code}</p>`,
    outro:
      "此驗證碼 10 分鐘內有效，且僅能使用一次。若你並未要求此驗證碼，請忽略這封信並儘速確認帳號安全。<br>This code is valid for 10 minutes and can be used once. If you didn't request it, ignore this email and secure your account.",
  });
}

function activatedEmailHtml(): string {
  return renderEmail({
    heading: "已開啟兩步驟驗證 · Two-factor turned on",
    intro:
      "<p>你的 NOJV 帳號已開啟兩步驟驗證。管理 API 權杖等敏感操作將要求第二重驗證(驗證器或 passkey)。</p><p>Two-factor authentication is now on for your NOJV account. Sensitive actions such as managing API tokens will require a second factor (authenticator or passkey).</p>",
    outro:
      "若這不是你本人操作，請立即聯絡管理員。<br>If this wasn't you, contact an administrator immediately.",
  });
}

function deactivatedEmailHtml(): string {
  return renderEmail({
    heading: "已關閉兩步驟驗證 · Two-factor turned off",
    intro:
      "<p>你的 NOJV 帳號已關閉兩步驟驗證。你設定的驗證器與 passkey 仍會保留，重新開啟後即可再次生效。</p><p>Two-factor authentication has been turned off for your NOJV account. Your authenticator and passkeys are kept and will work again once you turn it back on.</p>",
    outro:
      "若這不是你本人操作，請立即聯絡管理員並檢查帳號安全。<br>If this wasn't you, contact an administrator and secure your account.",
  });
}

const STEP_UP_FAIL_MESSAGE: Record<"malformed" | "replayed" | "invalid", string> = {
  malformed: "Enter a 6-digit code or a backup code.",
  replayed: "That code was already used. Wait for a new code.",
  invalid: "Invalid code. Try again.",
};

const EMAIL_OTP_FAIL_MESSAGE: Record<"expired" | "invalid" | "locked", string> = {
  expired: "That code has expired. Request a new one.",
  invalid: "Invalid code. Try again.",
  locked: "Too many attempts. Request a new code.",
};

interface StepUpFailure {
  ok: false;
  status: 400 | 401 | 403;
  error?: string;
  needsStepUp?: boolean;
}

/**
 * Authorizes a change to a user's 2FA configuration with a device step-up: a
 * TOTP/backup code or a fresh passkey assertion is required whenever a device
 * factor exists; email OTP is a fallback only when none does. Adding a method
 * (allowChangeGrant) also accepts a recent activation grant. A password is NOT
 * an accepted step-up here — sensitive 2FA changes require a device factor —
 * even though better-auth still needs the password to run enable/disable/
 * regenerate for password accounts (see passwordBodyForBetterAuth).
 */
async function authorizeTwoFactorChange(
  event: RequestEvent,
  formData: FormData,
  opts: { allowChangeGrant: boolean },
): Promise<{ ok: true } | StepUpFailure> {
  const actor = requireAuth(event);

  if (opts.allowChangeGrant && (await hasTwoFactorChangeGrant(actor.userId))) {
    return { ok: true };
  }

  if (await hasStepUpFactor(event)) {
    const code = formString(formData, "code");
    if (code) {
      const result = await verifyStepUpCode(actor.userId, code, event.request.headers);
      if (result.ok) return { ok: true };
      return {
        ok: false,
        status: result.reason === "malformed" ? 400 : 401,
        error: STEP_UP_FAIL_MESSAGE[result.reason],
      };
    }
    if (await hasFreshStepUp(actor.userId)) return { ok: true };
    return { ok: false, status: 403, needsStepUp: true };
  }

  const otp = formString(formData, "otp");
  if (!otp) return { ok: false, status: 403, needsStepUp: true };
  const result = await verifyActivationOtp(actor.userId, otp);
  if (result.ok) return { ok: true };
  return {
    ok: false,
    status: result.reason === "invalid" ? 401 : 400,
    error: EMAIL_OTP_FAIL_MESSAGE[result.reason],
  };
}

/**
 * better-auth requires the account password to run enable/disable/regenerate for
 * password accounts even with allowPasswordless. It is plumbing for those calls,
 * not the authorization for the change (that is authorizeTwoFactorChange).
 */
async function passwordBodyForBetterAuth(
  userId: string,
  formData: FormData,
): Promise<{ password?: string }> {
  if (!(await userHasCredentialPassword(userId))) return {};
  const password = formString(formData, "password");
  return password ? { password } : {};
}

async function withinStepUpAttemptLimit(userId: string): Promise<boolean> {
  try {
    await stepUpAttemptRateLimiter.consume(userId);
    return true;
  } catch {
    return false;
  }
}

export const loadTwoFactor = async (event: RequestEvent) => {
  const actor = requireAuth(event);
  const passkeys = await getAuth().api.listPasskeys({ headers: event.request.headers });
  return {
    twoFactorActivated: await isTwoFactorActivated(actor.userId),
    twoFactorEnabled: event.locals.sessionUser?.twoFactorEnabled ?? false,
    isSuperAdmin: event.locals.sessionUser?.isSuperAdmin ?? false,
    hasPassword: await userHasCredentialPassword(actor.userId),
    returnTo: sanitizeReturnTo(event.url.searchParams.get("returnTo")),
    verifyAutoOpen: event.url.searchParams.get("verify") === "totp",
    activateAutoOpen: event.url.searchParams.get("setup2fa") === "1",
    passkeys: passkeys.map((p) => ({
      id: p.id,
      name: p.name ?? "Passkey",
      createdAt: p.createdAt,
    })),
  };
};

export const twoFactorActions = {
  sendEmailOtp: async (event) => {
    const actor = requireAuth(event);
    const activated = await isTwoFactorActivated(actor.userId);
    const passkeys = await getAuth().api.listPasskeys({ headers: event.request.headers });
    const hasDeviceFactor =
      (event.locals.sessionUser?.twoFactorEnabled ?? false) || passkeys.length > 0;
    if (activated && hasDeviceFactor) {
      return fail(400, { error: "Use your authenticator or passkey to verify." });
    }
    try {
      await otpSendRateLimiter.consume(actor.userId);
    } catch {
      return fail(429, { error: "Too many requests. Please try again later." });
    }
    const otp = generateActivationOtp();
    await storeActivationOtp(actor.userId, otp);
    try {
      await getMailer().sendEmail({
        to: actor.email,
        subject: "NOJV 兩步驟驗證碼",
        html: otpEmailHtml(otp),
      });
    } catch (err) {
      logger.error("2FA email OTP send failed", {
        err: err instanceof Error ? err.message : String(err),
      });
      return fail(502, { error: "Could not send the code. Please try again." });
    }
    if (getWebEnv().NODE_ENV === "development") {
      return { sent: true, devOtp: otp };
    }
    return { sent: true };
  },

  activate: async (event) => {
    const actor = requireAuth(event);
    if (await isTwoFactorActivated(actor.userId)) {
      return fail(400, { error: "Two-factor authentication is already on." });
    }
    try {
      await stepUpAttemptRateLimiter.consume(actor.userId);
    } catch {
      return fail(429, { error: "Too many attempts. Please try again later." });
    }
    const otp = formString(await event.request.formData(), "otp");
    const result = await verifyActivationOtp(actor.userId, otp);
    if (!result.ok) {
      return fail(result.reason === "invalid" ? 401 : 400, {
        error: EMAIL_OTP_FAIL_MESSAGE[result.reason],
      });
    }
    await setTwoFactorActivated(actor.userId, true);
    await markTwoFactorChangeGrant(actor.userId);
    try {
      await getMailer().sendEmail({
        to: actor.email,
        subject: "NOJV 已開啟兩步驟驗證",
        html: activatedEmailHtml(),
      });
    } catch (err) {
      logger.error("2FA activated notification email failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return { activated: true };
  },

  deactivate: async (event) => {
    const actor = requireAuth(event);
    if (!(await isTwoFactorActivated(actor.userId))) {
      return fail(400, { error: "Two-factor authentication is not on." });
    }
    if (!(await withinStepUpAttemptLimit(actor.userId))) {
      return fail(429, { error: "Too many attempts. Please try again later." });
    }
    const formData = await event.request.formData();
    const authz = await authorizeTwoFactorChange(event, formData, { allowChangeGrant: false });
    if (!authz.ok) {
      return fail(
        authz.status,
        authz.needsStepUp ? { needsStepUp: true } : { error: authz.error },
      );
    }
    await setTwoFactorActivated(actor.userId, false);
    await clearStepUp(actor.userId);
    await clearTwoFactorChangeGrant(actor.userId);
    try {
      await getMailer().sendEmail({
        to: actor.email,
        subject: "NOJV 已關閉兩步驟驗證",
        html: deactivatedEmailHtml(),
      });
    } catch (err) {
      logger.error("2FA deactivated notification email failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return { deactivated: true };
  },

  enable: async (event) => {
    const actor = requireAuth(event);
    if (!(await isTwoFactorActivated(actor.userId))) {
      return fail(400, { needsActivation: true });
    }
    const formData = await event.request.formData();
    const authz = await authorizeTwoFactorChange(event, formData, { allowChangeGrant: true });
    if (!authz.ok) {
      return fail(
        authz.status,
        authz.needsStepUp ? { needsStepUp: true } : { error: authz.error },
      );
    }
    const body = await passwordBodyForBetterAuth(actor.userId, formData);
    try {
      const res = await getAuth().api.enableTwoFactor({
        body,
        headers: event.request.headers,
      });
      return { totpURI: res.totpURI, backupCodes: res.backupCodes };
    } catch {
      return fail(400, {
        error: "Could not start enrollment. Check your details and try again.",
      });
    }
  },

  verify: async (event) => {
    requireAuth(event);
    const formData = await event.request.formData();
    const code = formString(formData, "code");
    try {
      const { headers } = await getAuth().api.verifyTOTP({
        body: { code },
        headers: event.request.headers,
        returnHeaders: true,
      });
      forwardSetCookies(event, headers);
      const sessionId = event.locals.session?.id;
      if (sessionId && event.locals.sessionUser?.isSuperAdmin) {
        await markAdminSessionMfa(sessionId);
      }
    } catch {
      return fail(401, { error: "Invalid code. Try again." });
    }
    const returnTo = sanitizeReturnTo(
      formString(formData, "returnTo") || event.url.searchParams.get("returnTo"),
    );
    if (returnTo) {
      redirect(303, returnTo);
    }
    return { enabled: true };
  },

  disable: async (event) => {
    const actor = requireAuth(event);
    if (!event.locals.sessionUser?.twoFactorEnabled) {
      return fail(400, { error: "Two-factor authentication is not enabled." });
    }
    if (!(await withinStepUpAttemptLimit(actor.userId))) {
      return fail(429, { error: "Too many attempts. Please try again later." });
    }
    const formData = await event.request.formData();
    const authz = await authorizeTwoFactorChange(event, formData, { allowChangeGrant: false });
    if (!authz.ok) {
      return fail(
        authz.status,
        authz.needsStepUp ? { needsStepUp: true } : { error: authz.error },
      );
    }
    const body = await passwordBodyForBetterAuth(actor.userId, formData);
    try {
      const { headers } = await getAuth().api.disableTwoFactor({
        body,
        headers: event.request.headers,
        returnHeaders: true,
      });
      forwardSetCookies(event, headers);
      await clearStepUp(actor.userId);
      return { disabled: true };
    } catch {
      return fail(400, { error: "Could not disable. Check your details and try again." });
    }
  },

  regenerate: async (event) => {
    const actor = requireAuth(event);
    if (!event.locals.sessionUser?.twoFactorEnabled) {
      return fail(400, { error: "Two-factor authentication is not enabled." });
    }
    if (!(await withinStepUpAttemptLimit(actor.userId))) {
      return fail(429, { error: "Too many attempts. Please try again later." });
    }
    const formData = await event.request.formData();
    const authz = await authorizeTwoFactorChange(event, formData, { allowChangeGrant: false });
    if (!authz.ok) {
      return fail(
        authz.status,
        authz.needsStepUp ? { needsStepUp: true } : { error: authz.error },
      );
    }
    const body = await passwordBodyForBetterAuth(actor.userId, formData);
    try {
      const res = await getAuth().api.generateBackupCodes({
        body,
        headers: event.request.headers,
      });
      return { backupCodes: res.backupCodes };
    } catch {
      return fail(400, {
        error: "Could not regenerate codes. Check your details and try again.",
      });
    }
  },

  deletePasskey: async (event) => {
    const actor = requireAuth(event);
    const formData = await event.request.formData();
    const id = formString(formData, "id");
    if (!id) {
      return fail(400, { error: "Missing passkey id." });
    }
    if (!(await withinStepUpAttemptLimit(actor.userId))) {
      return fail(429, { error: "Too many attempts. Please try again later." });
    }
    const authz = await authorizeTwoFactorChange(event, formData, { allowChangeGrant: false });
    if (!authz.ok) {
      return fail(
        authz.status,
        authz.needsStepUp ? { needsStepUp: true } : { error: authz.error },
      );
    }
    try {
      await getAuth().api.deletePasskey({ body: { id }, headers: event.request.headers });
    } catch {
      return fail(400, { error: "Could not remove this passkey." });
    }
    return { deletedPasskey: true };
  },
} satisfies Actions;
