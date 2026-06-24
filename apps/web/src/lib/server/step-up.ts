import {
  clearStepUp,
  generateOtp,
  hashOtp,
  hasFreshStepUp,
  isBackupCodeFormat,
  markStepUpFresh,
  markTotpSeen,
  OTP_LENGTH,
  storeEnrollOtp,
  userHasCredentialPassword,
  validateStepUpCode,
  verifyEnrollOtp,
  wasTotpSeen,
} from "@nojv/application";

import { getAuth } from "$lib/auth.server";

export {
  clearStepUp,
  generateOtp,
  hashOtp,
  hasFreshStepUp,
  isBackupCodeFormat,
  markStepUpFresh,
  markTotpSeen,
  OTP_LENGTH,
  storeEnrollOtp,
  userHasCredentialPassword,
  validateStepUpCode,
  verifyEnrollOtp,
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
