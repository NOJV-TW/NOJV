import type { RequestEvent } from "@sveltejs/kit";

import {
  clearStepUp,
  hasAdminSessionMfa,
  hasFreshStepUp,
  isBackupCodeFormat,
  markAdminSessionMfa,
  markStepUpFresh,
  markTotpSeen,
  userHasCredentialPassword,
  validateStepUpCode,
  wasTotpSeen,
} from "@nojv/application";

import { getAuth } from "$lib/auth.server";

export {
  clearStepUp,
  hasAdminSessionMfa,
  hasFreshStepUp,
  isBackupCodeFormat,
  markAdminSessionMfa,
  markStepUpFresh,
  markTotpSeen,
  userHasCredentialPassword,
  validateStepUpCode,
  wasTotpSeen,
};

export async function verifyTotpStepUp(code: string, headers: Headers): Promise<boolean> {
  try {
    await getAuth().api.verifyTOTP({ body: { code }, headers });
    return true;
  } catch {
    return false;
  }
}

export async function verifyBackupCodeStepUp(code: string, headers: Headers): Promise<boolean> {
  try {
    await getAuth().api.verifyBackupCode({ body: { code }, headers });
    return true;
  } catch {
    return false;
  }
}

/**
 * A user can complete a step-up if they have an enrolled factor — TOTP/2FA or a
 * passkey. Both are provider-independent, so this is the same gate for password
 * and OAuth-only accounts.
 */
export async function hasStepUpFactor(event: RequestEvent): Promise<boolean> {
  if (event.locals.sessionUser?.twoFactorEnabled) return true;
  const passkeys = await getAuth().api.listPasskeys({ headers: event.request.headers });
  return passkeys.length > 0;
}

export type StepUpVerifyResult =
  | { ok: true }
  | { ok: false; reason: "malformed" | "replayed" | "invalid" };

export async function verifyStepUpCode(
  userId: string,
  code: string,
  headers: Headers,
): Promise<StepUpVerifyResult> {
  if (validateStepUpCode(code)) {
    if (await wasTotpSeen(userId, code)) return { ok: false, reason: "replayed" };
    if (!(await verifyTotpStepUp(code, headers))) return { ok: false, reason: "invalid" };
    await markTotpSeen(userId, code);
    return { ok: true };
  }
  if (isBackupCodeFormat(code)) {
    if (!(await verifyBackupCodeStepUp(code, headers))) return { ok: false, reason: "invalid" };
    return { ok: true };
  }
  return { ok: false, reason: "malformed" };
}
