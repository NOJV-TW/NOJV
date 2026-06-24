import { createHash, randomBytes } from "node:crypto";

import { getRedis, keys } from "@nojv/redis";

const ENROLL_CONFIRM_TTL_SECONDS = 600;

function hashEnrollToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function generateEnrollToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function storeEnrollConfirm(userId: string, token: string): Promise<void> {
  await getRedis().set(
    keys.twoFactorEnrollConfirm(hashEnrollToken(token)),
    userId,
    "EX",
    ENROLL_CONFIRM_TTL_SECONDS,
  );
}

export async function peekEnrollConfirm(token: string): Promise<string | null> {
  return getRedis().get(keys.twoFactorEnrollConfirm(hashEnrollToken(token)));
}

export async function confirmEnroll(token: string): Promise<string | null> {
  const redis = getRedis();
  const tokenKey = keys.twoFactorEnrollConfirm(hashEnrollToken(token));
  const userId = await redis.get(tokenKey);
  if (userId === null) return null;
  await redis.del(tokenKey);
  await redis.set(keys.twoFactorEnrollConfirmed(userId), "1", "EX", ENROLL_CONFIRM_TTL_SECONDS);
  return userId;
}

export async function hasEnrollConfirmed(userId: string): Promise<boolean> {
  return (await getRedis().get(keys.twoFactorEnrollConfirmed(userId))) !== null;
}

export async function clearEnrollConfirmed(userId: string): Promise<void> {
  await getRedis().del(keys.twoFactorEnrollConfirmed(userId));
}
