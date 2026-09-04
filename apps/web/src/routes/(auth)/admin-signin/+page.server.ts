import {
  areSecuritySettingsUnlocked,
  clearVerifiedSessionProofs,
  deleteAuthSession,
  findAdminSignInUser,
  findAuthSessionByToken,
  generateSecuritySetupOtp,
  getSecurityFactorState,
  getSuperAdminSecurityUser,
  hasAdminSessionMfa,
  preserveSuperAdminSessionStart,
  resetSecurityFactorsForRecovery,
  securityGenerationProof,
  storeSuperAdminRecoveryOtp,
  unlockSecuritySettings,
  userDomain,
  verifySuperAdminRecoveryOtp,
} from "@nojv/application";
import { getMailer, renderEmail } from "@nojv/mailer";
import { fail, redirect } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";

import { getAuth } from "$lib/auth.server";
import { getWebEnv } from "$lib/server/env";
import { createLogger } from "$lib/server/logger";
import { getClientIp } from "$lib/server/shared/client-ip";
import { withRateLimitActions } from "$lib/server/shared/action-handlers";
import { signInRateLimiter } from "$lib/server/shared/rate-limiter";
import { otpSendRateLimiter } from "$lib/server/shared/rate-limiter";
import {
  issueSuperAdminPasswordProof,
  isSuperAdminPasswordProofSessionValid,
  readSuperAdminPasswordProof,
  SUPER_ADMIN_PASSWORD_PROOF_COOKIE,
  type SuperAdminPasswordProof,
} from "$lib/server/super-admin-password-proof";
import { twoFactorActions } from "../../(app)/settings/two-factor-actions";

import type { Actions, PageServerLoad } from "./$types";

type AdminSignInPhase =
  "password" | "change-password" | "email-setup" | "choose-factor" | "verify-factor";

const logger = createLogger("admin-signin");

function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function formRawString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function safeReturnTo(value: string | null): string {
  return value?.startsWith("/") && !value.startsWith("//") && !value.includes("\\")
    ? value
    : "/admin";
}

function recoveryOtpEmailHtml(code: string): string {
  return renderEmail({
    heading: "Super admin 帳號復原 · Account recovery",
    intro: `<p>請在 NOJV 輸入以下驗證碼以重設安全驗證方式。完成後仍需設定新的驗證器或 passkey，才會取得管理權限。</p><p>Enter this code on NOJV to reset your security factors. You must set up a new authenticator or passkey before admin access is restored.</p><p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:20px 0">${code}</p>`,
    outro:
      "此驗證碼 10 分鐘內有效，且僅能使用一次。若你未要求帳號復原，請立即聯絡管理員。<br>This code is valid for 10 minutes and can be used once. If you did not request recovery, contact an administrator immediately.",
  });
}

async function requirePasswordProof(
  event: RequestEvent,
): Promise<SuperAdminPasswordProof | null> {
  const ticket = event.cookies.get(SUPER_ADMIN_PASSWORD_PROOF_COOKIE);
  if (!ticket) return null;
  const proof = await readSuperAdminPasswordProof(ticket);
  if (!proof) return null;
  if (!isSuperAdminPasswordProofSessionValid(proof, event.locals.session?.id ?? null)) {
    return null;
  }
  const user = await getSuperAdminSecurityUser(proof.userId);
  return user?.isSuperAdmin ? proof : null;
}

async function bindRecoverySession(
  event: RequestEvent,
  passwordProof: SuperAdminPasswordProof,
  sessionId: string,
): Promise<void> {
  const authenticatedAt = new Date(passwordProof.authenticatedAt);
  await preserveSuperAdminSessionStart(sessionId, authenticatedAt);
  const latest = await getSuperAdminSecurityUser(passwordProof.userId);
  if (!latest) throw new Error("Super admin disappeared while binding recovery session.");
  const proof = securityGenerationProof(latest);
  await clearVerifiedSessionProofs(sessionId);
  if (!(await unlockSecuritySettings(sessionId, proof))) {
    throw new Error("Could not issue recovery setup grant.");
  }
  await issueSuperAdminPasswordProof(event.cookies, {
    authenticatedAt: passwordProof.authenticatedAt,
    securityGeneration: proof.securityGeneration,
    sessionId,
    userId: proof.userId,
  });
}

function forwardSetCookies(event: RequestEvent, headers: Headers): void {
  for (const raw of headers.getSetCookie()) {
    const [pair, ...attributes] = raw.split(";");
    if (!pair) continue;
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    const options: Parameters<typeof event.cookies.set>[2] = {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      encode: (value) => value,
    };
    for (const attribute of attributes) {
      const [rawKey, ...rawValue] = attribute.trim().split("=");
      const key = rawKey?.toLowerCase();
      const value = rawValue.join("=");
      if (key === "path") options.path = value;
      else if (key === "domain") options.domain = value;
      else if (key === "max-age") options.maxAge = Number(value);
      else if (key === "expires") options.expires = new Date(value);
      else if (key === "samesite")
        options.sameSite = value.toLowerCase() as "lax" | "strict" | "none";
      else if (key === "secure") options.secure = true;
    }
    event.cookies.set(
      pair.slice(0, separator).trim(),
      pair.slice(separator + 1).trim(),
      options,
    );
  }
}

async function phaseForSuperAdmin(event: RequestEvent): Promise<{
  hasPasskey: boolean;
  hasTotp: boolean;
  phase: AdminSignInPhase;
}> {
  const user = event.locals.sessionUser;
  const session = event.locals.session;
  if (user?.isSuperAdmin && session) {
    const state = await getSecurityFactorState(user.id);
    if (!state) return { hasPasskey: false, hasTotp: false, phase: "password" };
    if (user.mustChangePassword) {
      return { ...state, phase: "change-password" };
    }
    if (await hasAdminSessionMfa(session.id, securityGenerationProof(user))) {
      redirect(303, safeReturnTo(event.url.searchParams.get("returnTo")));
    }
    if (!state.hasSecurityFactor) {
      const unlocked = await areSecuritySettingsUnlocked(
        session.id,
        securityGenerationProof(user),
      );
      return { ...state, phase: unlocked ? "choose-factor" : "email-setup" };
    }
    return { ...state, phase: "verify-factor" };
  }

  const ticket = event.cookies.get(SUPER_ADMIN_PASSWORD_PROOF_COOKIE);
  const proof = ticket ? await readSuperAdminPasswordProof(ticket) : null;
  if (!proof) return { hasPasskey: false, hasTotp: false, phase: "password" };
  const state = await getSecurityFactorState(proof.userId);
  return state
    ? { ...state, phase: "verify-factor" }
    : { hasPasskey: false, hasTotp: false, phase: "password" };
}

export const load: PageServerLoad = async (event) => {
  if (event.locals.sessionUser && !event.locals.sessionUser.isSuperAdmin) {
    redirect(303, "/dashboard");
  }
  return {
    ...(await phaseForSuperAdmin(event)),
    returnTo: safeReturnTo(event.url.searchParams.get("returnTo")),
  };
};

const actionHandlers = {
  password: async (event: RequestEvent) => {
    const rateLimit = await signInRateLimiter.consume(getClientIp(event));
    if (rateLimit !== "allowed") {
      return fail(rateLimit === "limited" ? 429 : 503, {
        error:
          rateLimit === "limited"
            ? "Too many sign-in attempts. Try again later."
            : "Authentication is temporarily unavailable.",
      });
    }
    const formData = await event.request.formData();
    const identity = formString(formData, "identity");
    const password = formRawString(formData, "password");
    if (!identity || !password) return fail(400, { error: "Enter your account and password." });

    let result;
    try {
      result = identity.includes("@")
        ? await getAuth().api.signInEmail({
            body: { email: identity, password },
            headers: event.request.headers,
            returnHeaders: true,
          })
        : await getAuth().api.signInUsername({
            body: { username: identity, password },
            headers: event.request.headers,
            returnHeaders: true,
          });
    } catch {
      return fail(401, { error: "Invalid account or password." });
    }

    const user = await findAdminSignInUser(identity);
    if (user?.platformRole !== "admin") {
      return fail(403, { error: "This sign-in is only for administrator accounts." });
    }
    forwardSetCookies(event, result.headers);
    const signInResponse = result.response;
    const state = await getSecurityFactorState(user.id);
    if (!state) return fail(403, { error: "Administrator account not found." });
    if (!user.isSuperAdmin) {
      return "twoFactorRedirect" in signInResponse && signInResponse.twoFactorRedirect
        ? {
            hasPasskey: state.hasPasskey,
            hasTotp: state.hasTotp,
            phase: "verify-factor" as const,
            regularAdmin: true,
          }
        : { destination: "/dashboard", phase: "complete" as const };
    }

    const token =
      "token" in signInResponse && typeof signInResponse.token === "string"
        ? signInResponse.token
        : null;
    const session = token ? await findAuthSessionByToken(token) : null;
    await issueSuperAdminPasswordProof(event.cookies, {
      authenticatedAt: (session?.createdAt ?? new Date()).toISOString(),
      securityGeneration: user.securityGeneration,
      sessionId: session?.id ?? null,
      userId: user.id,
    });
    const phase: AdminSignInPhase = user.mustChangePassword
      ? "change-password"
      : state.hasSecurityFactor
        ? "verify-factor"
        : "email-setup";
    return { hasPasskey: state.hasPasskey, hasTotp: state.hasTotp, phase };
  },

  changePassword: async (event: RequestEvent) => {
    const user = event.locals.sessionUser;
    const session = event.locals.session;
    if (!user?.isSuperAdmin || !session || !user.mustChangePassword) {
      return fail(403, { error: "Password setup is not available." });
    }
    const formData = await event.request.formData();
    const currentPassword = formRawString(formData, "currentPassword");
    const newPassword = formRawString(formData, "newPassword");
    const confirmPassword = formRawString(formData, "confirmPassword");
    if (newPassword.length < 8)
      return fail(400, { error: "Password must be at least 8 characters." });
    if (newPassword !== confirmPassword)
      return fail(400, { error: "The new passwords do not match." });
    let passwordChange;
    try {
      passwordChange = await getAuth().api.changePassword({
        body: { currentPassword, newPassword, revokeOtherSessions: true },
        headers: event.request.headers,
        returnHeaders: true,
      });
    } catch {
      return fail(400, { error: "The current password is incorrect." });
    }
    const rotatedToken =
      typeof passwordChange.response.token === "string" ? passwordChange.response.token : null;
    const rotatedSession = rotatedToken ? await findAuthSessionByToken(rotatedToken) : null;
    if (!rotatedSession) {
      return fail(500, { error: "Could not establish the new session." });
    }
    await preserveSuperAdminSessionStart(rotatedSession.id, new Date(session.createdAt));
    forwardSetCookies(event, passwordChange.headers);
    await userDomain.markPasswordChanged(user.id);
    const latest = await getSuperAdminSecurityUser(user.id);
    if (!latest) return fail(404, { error: "Super admin account not found." });
    await issueSuperAdminPasswordProof(event.cookies, {
      authenticatedAt: new Date(session.createdAt).toISOString(),
      securityGeneration: latest.securityGeneration,
      sessionId: rotatedSession.id,
      userId: latest.id,
    });
    const state = await getSecurityFactorState(user.id);
    return {
      passwordChanged: true,
      phase: state?.hasSecurityFactor ? ("verify-factor" as const) : ("email-setup" as const),
    };
  },

  sendSecuritySetupOtp: twoFactorActions.sendSecuritySetupOtp,
  unlockSecuritySettings: twoFactorActions.unlockSecuritySettings,
  beginTotpSetup: twoFactorActions.beginTotpSetup,
  confirmTotpSetup: twoFactorActions.confirmTotpSetup,

  sendRecoveryEmailOtp: async (event: RequestEvent) => {
    const proof = await requirePasswordProof(event);
    if (!proof) return fail(403, { error: "Verify your password again before recovery." });
    const rateLimit = await otpSendRateLimiter.consume(proof.userId);
    if (rateLimit !== "allowed") {
      return fail(rateLimit === "limited" ? 429 : 503, {
        error:
          rateLimit === "limited"
            ? "Too many requests. Try again later."
            : "Email verification is temporarily unavailable.",
      });
    }
    const user = await getSuperAdminSecurityUser(proof.userId);
    if (!user) return fail(404, { error: "Super admin account not found." });
    const otp = generateSecuritySetupOtp();
    await storeSuperAdminRecoveryOtp(proof.userId, otp);
    try {
      const delivery = await getMailer().sendEmail({
        to: user.email,
        subject: "NOJV Super admin 帳號復原",
        html: recoveryOtpEmailHtml(otp),
      });
      if (delivery === "suppressed" && getWebEnv().NODE_ENV !== "test") {
        return fail(503, { error: "Email delivery is unavailable. Please try again later." });
      }
    } catch (error) {
      logger.error("Super admin recovery OTP send failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(502, { error: "Could not send the code. Please try again." });
    }
    return getWebEnv().NODE_ENV === "development"
      ? { devOtp: otp, sent: true }
      : { sent: true };
  },

  recoverWithBackupCode: async (event: RequestEvent) => {
    const passwordProof = await requirePasswordProof(event);
    if (!passwordProof) {
      return fail(403, { error: "Verify your password again before recovery." });
    }
    const code = formString(await event.request.formData(), "backupCode");
    let verification;
    try {
      verification = await getAuth().api.verifyBackupCode({
        body: { code },
        headers: event.request.headers,
        returnHeaders: true,
      });
    } catch {
      return fail(401, { error: "Invalid backup code." });
    }
    const rawToken = verification.response.token;
    const token = typeof rawToken === "string" ? rawToken : null;
    const session = token ? await findAuthSessionByToken(token) : null;
    if (session?.userId !== passwordProof.userId) {
      return fail(403, { error: "Recovery session could not be established." });
    }
    await resetSecurityFactorsForRecovery(passwordProof.userId, session.id);
    await bindRecoverySession(event, passwordProof, session.id);
    forwardSetCookies(event, verification.headers);
    return { recovered: true, phase: "choose-factor" as const };
  },

  recoverWithEmailOtp: async (event: RequestEvent) => {
    const passwordProof = await requirePasswordProof(event);
    if (!passwordProof) {
      return fail(403, { error: "Verify your password again before recovery." });
    }
    const formData = await event.request.formData();
    const result = await verifySuperAdminRecoveryOtp(
      passwordProof.userId,
      formString(formData, "otp"),
    );
    if (!result.ok) return fail(401, { error: "Invalid or expired email code." });
    const password = formRawString(formData, "password");
    const user = await getSuperAdminSecurityUser(passwordProof.userId);
    if (!user || !password) {
      return fail(401, { error: "Sign in again before continuing recovery." });
    }
    try {
      await getAuth().api.signInEmail({
        body: { email: user.email, password },
        headers: event.request.headers,
      });
    } catch {
      return fail(401, { error: "Sign in again before continuing recovery." });
    }
    await resetSecurityFactorsForRecovery(passwordProof.userId, null);
    let signIn;
    try {
      signIn = await getAuth().api.signInEmail({
        body: { email: user.email, password },
        headers: event.request.headers,
        returnHeaders: true,
      });
    } catch {
      return fail(401, { error: "Password verification expired. Sign in again." });
    }
    const token = typeof signIn.response.token === "string" ? signIn.response.token : null;
    const session = token ? await findAuthSessionByToken(token) : null;
    if (session?.userId !== passwordProof.userId) {
      if (session) await deleteAuthSession(session.id);
      return fail(403, { error: "Recovery session could not be established." });
    }
    await bindRecoverySession(event, passwordProof, session.id);
    forwardSetCookies(event, signIn.headers);
    return { recovered: true, phase: "choose-factor" as const };
  },
};

export const actions: Actions = withRateLimitActions(actionHandlers);
