import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import { accountRepo } from "@nojv/db";
import { getRedis, keys } from "@nojv/redis";

import { apiTokenPepper } from "./lifecycle";

const STEPUP_TTL_SECONDS = 600;
const OTP_TTL_SECONDS = 600;
const OTP_DEDUPE_TTL_SECONDS = 120;
export const OTP_LENGTH = 6;

export function hashOtp(otp: string): string {
  return createHmac("sha256", apiTokenPepper()).update(otp).digest("base64url");
}

export function generateOtp(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");
}

const STEPUP_CODE_PATTERN = new RegExp(`^\\d{${String(OTP_LENGTH)}}$`);
const BACKUP_CODE_PATTERN = /^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/;

export function validateStepUpCode(code: string): boolean {
  return STEPUP_CODE_PATTERN.test(code);
}

export function isBackupCodeFormat(code: string): boolean {
  return BACKUP_CODE_PATTERN.test(code);
}

export async function storeEnrollOtp(userId: string, otp: string): Promise<void> {
  await getRedis().set(keys.twoFactorEnrollOtp(userId), hashOtp(otp), "EX", OTP_TTL_SECONDS);
}

export async function verifyEnrollOtp(userId: string, otp: string): Promise<boolean> {
  const stored = await getRedis().get(keys.twoFactorEnrollOtp(userId));
  if (stored === null) return false;
  const presented = hashOtp(otp);
  if (stored.length !== presented.length) return false;
  if (!timingSafeEqual(Buffer.from(stored), Buffer.from(presented))) return false;
  await getRedis().del(keys.twoFactorEnrollOtp(userId));
  return true;
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

export function userHasCredentialPassword(userId: string): Promise<boolean> {
  return accountRepo.hasCredentialPassword(userId);
}
