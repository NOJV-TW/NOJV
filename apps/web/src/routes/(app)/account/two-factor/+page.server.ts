import { fail, redirect } from "@sveltejs/kit";
import type { Actions, RequestEvent } from "@sveltejs/kit";
import type { Session } from "better-auth";

import { env } from "$env/dynamic/private";
import { getAuth } from "$lib/auth.server";
import { requireAuth } from "$lib/server/auth";
import { createLogger } from "$lib/server/logger";
import { getMailer } from "$lib/server/mailer";
import { renderEmail } from "$lib/server/mailer/template";
import { otpSendRateLimiter } from "$lib/server/shared/rate-limiter";
import {
  clearStepUp,
  markAdminSessionMfa,
  userHasCredentialPassword,
  verifyStepUpCode,
} from "$lib/server/step-up";
import {
  clearEnrollConfirmed,
  generateEnrollToken,
  hasEnrollConfirmed,
  storeEnrollConfirm,
} from "$lib/server/two-factor-enroll";

const logger = createLogger("two-factor");

const ENROLL_FRESH_WINDOW_MS = 5 * 60 * 1000;

function freshEnough(session: Session | null): boolean {
  if (!session) return false;
  return Date.now() - new Date(session.createdAt).getTime() < ENROLL_FRESH_WINDOW_MS;
}

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

function confirmEmailHtml(url: string): string {
  return renderEmail({
    heading: "確認啟用兩步驟驗證 · Confirm two-factor setup",
    intro:
      "<p>有人正在為你的 NOJV 帳號啟用兩步驟驗證。請點擊下方按鈕前往確認頁面。</p><p>Someone is enabling two-factor authentication on your NOJV account. Click the button below to confirm.</p>",
    action: { url, label: "確認啟用 · Confirm" },
    outro:
      "此連結 10 分鐘內有效。若你並未要求啟用，請忽略這封信並儘速確認帳號安全。<br>This link is valid for 10 minutes. If you didn't request this, ignore this email and secure your account.",
  });
}

function enabledEmailHtml(): string {
  return renderEmail({
    heading: "已啟用兩步驟驗證 · Two-factor enabled",
    intro:
      "<p>你的 NOJV 帳號已成功啟用兩步驟驗證 (TOTP)。從現在起，管理 API 權杖等敏感操作會要求輸入驗證器產生的驗證碼。</p><p>Two-factor authentication (TOTP) is now enabled on your NOJV account. Sensitive actions such as managing API tokens will now require a code from your authenticator.</p>",
    outro:
      "若這不是你本人操作，請立即聯絡管理員。<br>If this wasn't you, contact an administrator immediately.",
  });
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
    isSuperAdmin: event.locals.sessionUser?.isSuperAdmin ?? false,
    hasPassword: await userHasCredentialPassword(actor.userId),
    enrollConfirmed: await hasEnrollConfirmed(actor.userId),
    returnTo: sanitizeReturnTo(event.url.searchParams.get("returnTo")),
  };
};

export const actions = {
  sendConfirm: async (event) => {
    const actor = requireAuth(event);
    if (event.locals.sessionUser?.twoFactorEnabled) {
      return fail(400, { error: "Two-factor authentication is already enabled." });
    }
    if (await userHasCredentialPassword(actor.userId)) {
      return fail(400, { error: "Confirm your password instead of an email link." });
    }
    if (!freshEnough(event.locals.session)) {
      return fail(403, { needsReauth: true });
    }
    try {
      await otpSendRateLimiter.consume(actor.userId);
    } catch {
      return fail(429, { error: "Too many requests. Please try again later." });
    }
    const token = generateEnrollToken();
    await storeEnrollConfirm(actor.userId, token);
    if (!env.BETTER_AUTH_URL) throw new Error("BETTER_AUTH_URL is required");
    const confirmUrl = `${env.BETTER_AUTH_URL}/account/two-factor/confirm?token=${token}`;
    await getMailer().sendEmail({
      to: actor.email,
      subject: "NOJV 兩步驟驗證 — 確認啟用",
      html: confirmEmailHtml(confirmUrl),
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
    const passwordless = !(await userHasCredentialPassword(actor.userId));
    if (!passwordless) {
      const password = formString(formData, "password");
      if (!password) {
        return fail(400, { error: "Enter your password to continue." });
      }
      body.password = password;
    } else if (!(await hasEnrollConfirmed(actor.userId))) {
      return fail(400, {
        error: "Click the confirmation link we emailed you, then try again.",
      });
    }
    try {
      const res = await getAuth().api.enableTwoFactor({
        body,
        headers: event.request.headers,
      });
      if (passwordless) {
        await clearEnrollConfirmed(actor.userId);
      }
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
      const { headers } = await getAuth().api.verifyTOTP({
        body: { code },
        headers: event.request.headers,
        returnHeaders: true,
      });
      forwardSetCookies(event, headers);
      const sessionId = event.locals.session?.id;
      if (event.locals.sessionUser?.isSuperAdmin && sessionId) {
        await markAdminSessionMfa(sessionId);
      }
    } catch {
      return fail(401, { error: "Invalid code. Try again." });
    }
    try {
      await getMailer().sendEmail({
        to: actor.email,
        subject: "NOJV 已啟用兩步驟驗證",
        html: enabledEmailHtml(),
      });
    } catch (err) {
      logger.error("2FA enabled notification email failed", {
        err: err instanceof Error ? err.message : String(err),
      });
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
      const { headers } = await getAuth().api.disableTwoFactor({
        body,
        headers: event.request.headers,
        returnHeaders: true,
      });
      forwardSetCookies(event, headers);
      await clearStepUp(actor.userId);
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
