import { createHash, randomInt, timingSafeEqual } from "node:crypto";

import { userRepo } from "@nojv/db";
import { getRedis, keys } from "@nojv/redis";

const OTP_TTL_SECONDS = 600;
const OTP_MAX_ATTEMPTS = 5;
const CHANGE_GRANT_TTL_SECONDS = 600;

export function generateActivationOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function hashOtp(otp: string): string {
  return createHash("sha256").update(otp).digest("base64url");
}

export async function isTwoFactorActivated(userId: string): Promise<boolean> {
  const user = await userRepo.findById(userId);
  return user?.twoFactorActivated ?? false;
}

export async function setTwoFactorActivated(userId: string, activated: boolean): Promise<void> {
  await userRepo.update(userId, { twoFactorActivated: activated });
}

export async function storeActivationOtp(userId: string, otp: string): Promise<void> {
  const redis = getRedis();
  await redis.set(keys.twoFactorActivationOtp(userId), hashOtp(otp), "EX", OTP_TTL_SECONDS);
  await redis.del(keys.twoFactorActivationOtpAttempts(userId));
}

export type ActivationOtpResult =
  { ok: true } | { ok: false; reason: "expired" | "invalid" | "locked" };

export async function verifyActivationOtp(
  userId: string,
  otp: string,
): Promise<ActivationOtpResult> {
  const redis = getRedis();
  const key = keys.twoFactorActivationOtp(userId);
  const attemptsKey = keys.twoFactorActivationOtpAttempts(userId);

  const stored = await redis.get(key);
  if (stored === null) return { ok: false, reason: "expired" };

  const candidate = hashOtp(otp);
  const a = Buffer.from(candidate);
  const b = Buffer.from(stored);
  if (a.length === b.length && timingSafeEqual(a, b)) {
    await redis.del(key, attemptsKey);
    return { ok: true };
  }

  const attempts = await redis.incr(attemptsKey);
  if (attempts === 1) await redis.expire(attemptsKey, OTP_TTL_SECONDS);
  if (attempts >= OTP_MAX_ATTEMPTS) {
    await redis.del(key, attemptsKey);
    return { ok: false, reason: "locked" };
  }
  return { ok: false, reason: "invalid" };
}

export async function markTwoFactorChangeGrant(userId: string): Promise<void> {
  await getRedis().set(keys.twoFactorChangeGrant(userId), "1", "EX", CHANGE_GRANT_TTL_SECONDS);
}

export async function hasTwoFactorChangeGrant(userId: string): Promise<boolean> {
  return (await getRedis().get(keys.twoFactorChangeGrant(userId))) !== null;
}

export async function clearTwoFactorChangeGrant(userId: string): Promise<void> {
  await getRedis().del(keys.twoFactorChangeGrant(userId));
}
