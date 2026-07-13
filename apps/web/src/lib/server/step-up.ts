import type { RequestEvent } from "@sveltejs/kit";

import {
  adminElevationPrincipal,
  clearStepUp,
  consumeTotpCode,
  grantAdminElevation,
  hasAdminSessionMfa,
  hasFreshStepUp,
  hasTokenPageMfa,
  isSecurityGenerationCurrent,
  isSuperAdminSessionExpired,
  isTwoFactorActivated,
  markVerifiedSession,
  resolveAdminElevation,
  revokeAdminElevation,
  securityGenerationMarker,
  securityGenerationProof,
  userHasCredentialPassword,
  validateStepUpCode,
  type SecurityGenerationProof,
} from "@nojv/application";

import { getAuth } from "$lib/auth.server";

export {
  adminElevationPrincipal,
  clearStepUp,
  consumeTotpCode,
  grantAdminElevation,
  hasAdminSessionMfa,
  hasFreshStepUp,
  hasTokenPageMfa,
  isSecurityGenerationCurrent,
  isSuperAdminSessionExpired,
  isTwoFactorActivated,
  markVerifiedSession,
  resolveAdminElevation,
  revokeAdminElevation,
  securityGenerationMarker,
  securityGenerationProof,
  userHasCredentialPassword,
  validateStepUpCode,
};

export async function verifyTotpStepUp(code: string, headers: Headers): Promise<boolean> {
  try {
    await getAuth().api.verifyTOTP({ body: { code }, headers });
    return true;
  } catch {
    return false;
  }
}

/**
 * A user can complete a device step-up if the master switch is on and they have
 * an enrolled factor — TOTP/2FA or a passkey. Both are provider-independent, so
 * this is the same gate for password and OAuth-only accounts.
 */
export async function hasStepUpFactor(event: RequestEvent): Promise<boolean> {
  const userId = event.locals.sessionUser?.id;
  if (!userId || !(await isTwoFactorActivated(userId))) return false;
  if (event.locals.sessionUser?.twoFactorEnabled) return true;
  const passkeys = await getAuth().api.listPasskeys({ headers: event.request.headers });
  return passkeys.length > 0;
}

export type StepUpVerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason: "factor_unavailable" | "malformed" | "replayed" | "invalid" | "stale";
    };

export async function verifyStepUpCode(
  proof: SecurityGenerationProof,
  code: string,
  headers: Headers,
  twoFactorEnabled: boolean,
): Promise<StepUpVerifyResult> {
  if (validateStepUpCode(code)) {
    if (!twoFactorEnabled) return { ok: false, reason: "factor_unavailable" };
    if (!(await verifyTotpStepUp(code, headers))) return { ok: false, reason: "invalid" };
    if (!(await consumeTotpCode(proof.userId, code))) {
      return { ok: false, reason: "replayed" };
    }
    if (!(await isSecurityGenerationCurrent(proof))) return { ok: false, reason: "stale" };
    return { ok: true };
  }
  // Recovery codes remain available for account recovery through Better Auth,
  // but are intentionally not accepted for privileged step-up. Consuming one
  // mutates the factor state, so a pre-consumption authorization proof cannot
  // remain valid without unsafely rebinding to newer security state.
  return { ok: false, reason: "malformed" };
}
