import { accountRepo } from "@nojv/db";
import { getRedis, keys } from "@nojv/redis";

import { getAuth } from "$lib/auth.server";

const STEPUP_TTL_SECONDS = 600;
const OTP_DEDUPE_TTL_SECONDS = 120;
const TOTP_CODE_LENGTH = 6;

const STEPUP_CODE_PATTERN = new RegExp(`^\\d{${String(TOTP_CODE_LENGTH)}}$`);
const BACKUP_CODE_PATTERN = /^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/;

export function validateStepUpCode(code: string): boolean {
  return STEPUP_CODE_PATTERN.test(code);
}

export function isBackupCodeFormat(code: string): boolean {
  return BACKUP_CODE_PATTERN.test(code);
}

export async function markStepUpFresh(userId: string): Promise<void> {
  await getRedis().set(keys.apiTokenStepUp(userId), "1", "EX", STEPUP_TTL_SECONDS);
}

export async function hasFreshStepUp(userId: string): Promise<boolean> {
  return (await getRedis().get(keys.apiTokenStepUp(userId))) !== null;
}

export async function clearStepUp(userId: string): Promise<void> {
  await getRedis().del(keys.apiTokenStepUp(userId));
}

export async function markTotpSeen(userId: string, code: string): Promise<void> {
  await getRedis().set(keys.twoFactorTotpSeen(userId, code), "1", "EX", OTP_DEDUPE_TTL_SECONDS);
}

export async function wasTotpSeen(userId: string, code: string): Promise<boolean> {
  return (await getRedis().get(keys.twoFactorTotpSeen(userId, code))) !== null;
}

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

export function userHasCredentialPassword(userId: string): Promise<boolean> {
  return accountRepo.hasCredentialPassword(userId);
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
