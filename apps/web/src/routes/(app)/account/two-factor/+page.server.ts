import { fail, redirect } from "@sveltejs/kit";
import type { Actions, RequestEvent } from "@sveltejs/kit";
import type { Session } from "better-auth";

import { getAuth } from "$lib/auth.server";
import { requireAuth } from "$lib/server/auth";
import { getMailer } from "$lib/server/mailer";
import { otpSendRateLimiter } from "$lib/server/shared/rate-limiter";
import {
  generateOtp,
  storeEnrollOtp,
  userHasCredentialPassword,
  verifyEnrollOtp,
  verifyStepUpCode,
} from "$lib/server/step-up";

const ENROLL_FRESH_WINDOW_MS = 5 * 60 * 1000;

function freshEnough(session: Session | null): boolean {
  if (!session) return false;
  return Date.now() - new Date(session.createdAt).getTime() < ENROLL_FRESH_WINDOW_MS;
}

function sanitizeReturnTo(value: string | null): string | null {
  return typeof value === "string" && value.startsWith("/account/") ? value : null;
}

function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return (typeof value === "string" ? value : "").trim();
}

function otpEmailHtml(otp: string): string {
  return `<p>有人正在為你的 NOJV 帳號啟用兩步驟驗證。</p><p>啟用碼:<strong style="font-size:1.25rem;letter-spacing:0.2em">${otp}</strong></p><p>此驗證碼 10 分鐘內有效。若你並未要求啟用,請忽略這封信並儘速確認帳號安全。</p>`;
}

function enabledEmailHtml(): string {
  return `<p>你的 NOJV 帳號已成功啟用兩步驟驗證(TOTP)。</p><p>從現在起,管理 API 權杖等敏感操作會要求輸入驗證器產生的驗證碼。</p><p>若這不是你本人操作,請立即聯絡管理員。</p>`;
}

const STEP_UP_FAIL_MESSAGE: Record<"malformed" | "replayed" | "invalid", string> = {
  malformed: "Enter a 6-digit code or a backup code.",
  replayed: "That code was already used. Wait for a new code.",
  invalid: "Invalid code. Try again.",
};

export const load = async (event: RequestEvent) => {
  const actor = requireAuth(event);
  return {
    twoFactorEnabled: event.locals.sessionUser?.twoFactorEnabled ?? false,
    platformRole: event.locals.sessionUser?.platformRole ?? "student",
    hasPassword: await userHasCredentialPassword(actor.userId),
    returnTo: sanitizeReturnTo(event.url.searchParams.get("returnTo")),
  };
};

export const actions = {
  sendOtp: async (event) => {
    const actor = requireAuth(event);
    if (event.locals.sessionUser?.twoFactorEnabled) {
      return fail(400, { error: "Two-factor authentication is already enabled." });
    }
    if (await userHasCredentialPassword(actor.userId)) {
      return fail(400, { error: "Confirm your password instead of an email code." });
    }
    if (!freshEnough(event.locals.session)) {
      return fail(403, { needsReauth: true });
    }
    try {
      await otpSendRateLimiter.consume(actor.userId);
    } catch {
      return fail(429, { error: "Too many requests. Please try again later." });
    }
    const otp = generateOtp();
    await storeEnrollOtp(actor.userId, otp);
    await getMailer().sendEmail({
      to: actor.email,
      subject: "NOJV 兩步驟驗證啟用碼",
      html: otpEmailHtml(otp),
    });
    return { sent: true };
  },

  enable: async (event) => {
    const actor = requireAuth(event);
    if (!freshEnough(event.locals.session)) {
      return fail(403, { needsReauth: true });
    }
    const formData = await event.request.formData();
    const body: { password?: string } = {};
    if (await userHasCredentialPassword(actor.userId)) {
      const password = formString(formData, "password");
      if (!password) {
        return fail(400, { error: "Enter your password to continue." });
      }
      body.password = password;
    } else if (!(await verifyEnrollOtp(actor.userId, formString(formData, "otp")))) {
      return fail(400, { error: "That email code is incorrect or expired." });
    }
    try {
      const res = await getAuth().api.enableTwoFactor({
        body,
        headers: event.request.headers,
      });
      return { totpURI: res.totpURI, backupCodes: res.backupCodes };
    } catch {
      return fail(400, {
        error: "Could not start enrollment. Check your password and try again.",
      });
    }
  },

  verify: async (event) => {
    const actor = requireAuth(event);
    const formData = await event.request.formData();
    const code = formString(formData, "code");
    try {
      await getAuth().api.verifyTOTP({ body: { code }, headers: event.request.headers });
    } catch {
      return fail(401, { error: "Invalid code. Try again." });
    }
    await getMailer().sendEmail({
      to: actor.email,
      subject: "NOJV 已啟用兩步驟驗證",
      html: enabledEmailHtml(),
    });
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
    const formData = await event.request.formData();
    const body: { password?: string } = {};
    if (await userHasCredentialPassword(actor.userId)) {
      const password = formString(formData, "password");
      if (!password) {
        return fail(400, { error: "Enter your password to continue." });
      }
      body.password = password;
    } else {
      const result = await verifyStepUpCode(
        actor.userId,
        formString(formData, "code"),
        event.request.headers,
      );
      if (!result.ok) {
        return fail(result.reason === "malformed" ? 400 : 401, {
          error: STEP_UP_FAIL_MESSAGE[result.reason],
        });
      }
    }
    try {
      await getAuth().api.disableTwoFactor({ body, headers: event.request.headers });
      return { disabled: true };
    } catch {
      return fail(400, { error: "Could not disable. Check your password and try again." });
    }
  },

  regenerate: async (event) => {
    const actor = requireAuth(event);
    if (!event.locals.sessionUser?.twoFactorEnabled) {
      return fail(400, { error: "Two-factor authentication is not enabled." });
    }
    const formData = await event.request.formData();
    const body: { password?: string } = {};
    if (await userHasCredentialPassword(actor.userId)) {
      const password = formString(formData, "password");
      if (!password) {
        return fail(400, { error: "Enter your password to continue." });
      }
      body.password = password;
    } else {
      const result = await verifyStepUpCode(
        actor.userId,
        formString(formData, "code"),
        event.request.headers,
      );
      if (!result.ok) {
        return fail(result.reason === "malformed" ? 400 : 401, {
          error: STEP_UP_FAIL_MESSAGE[result.reason],
        });
      }
    }
    try {
      const res = await getAuth().api.generateBackupCodes({
        body,
        headers: event.request.headers,
      });
      return { backupCodes: res.backupCodes };
    } catch {
      return fail(400, {
        error: "Could not regenerate codes. Check your password and try again.",
      });
    }
  },
} satisfies Actions;
