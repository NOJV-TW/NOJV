import { createHash, randomInt } from "node:crypto";

import { userRepo } from "@nojv/db";
import { getRedis, keys } from "@nojv/redis";

import {
  isSecurityGenerationCurrent,
  securityGenerationMarker,
  type SecurityGenerationProof,
} from "./step-up";

const OTP_TTL_SECONDS = 600;
const OTP_MAX_ATTEMPTS = 5;
const CHANGE_GRANT_TTL_SECONDS = 600;

const VERIFY_ACTIVATION_OTP_SCRIPT = `
local stored = redis.call("GET", KEYS[1])
if not stored then
  return 0
end

if stored == ARGV[1] then
  redis.call("DEL", KEYS[1], KEYS[2])
  return 1
end

local attempts = redis.call("INCR", KEYS[2])
if attempts == 1 then
  redis.call("EXPIRE", KEYS[2], tonumber(ARGV[2]))
end
if attempts >= tonumber(ARGV[3]) then
  redis.call("DEL", KEYS[1], KEYS[2])
  return 3
end
return 2
`;

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

export async function setTwoFactorActivated(
  userId: string,
  activated: boolean,
): Promise<SecurityGenerationProof> {
  const user = await userRepo.update(userId, { twoFactorActivated: activated });
  return { userId: user.id, securityGeneration: user.securityGeneration };
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

  const outcome = Number(
    await redis.eval(
      VERIFY_ACTIVATION_OTP_SCRIPT,
      2,
      key,
      attemptsKey,
      hashOtp(otp),
      String(OTP_TTL_SECONDS),
      String(OTP_MAX_ATTEMPTS),
    ),
  );
  if (outcome === 1) return { ok: true };
  if (outcome === 0) return { ok: false, reason: "expired" };
  if (outcome === 2) return { ok: false, reason: "invalid" };
  if (outcome === 3) return { ok: false, reason: "locked" };
  throw new Error(`Unexpected activation OTP verification result: ${String(outcome)}`);
}

export type PasskeyRegistrationDenial = "not_activated" | "needs_step_up" | null;

export function passkeyRegistrationDenialReason(state: {
  activated: boolean;
  hasGrant: boolean;
  hasFresh: boolean;
}): PasskeyRegistrationDenial {
  if (!state.activated) return "not_activated";
  if (!state.hasGrant && !state.hasFresh) return "needs_step_up";
  return null;
}

export async function markTwoFactorChangeGrant(
  sessionId: string,
  proof: SecurityGenerationProof,
): Promise<boolean> {
  if (!(await isSecurityGenerationCurrent(proof))) return false;
  await getRedis().set(
    keys.twoFactorChangeGrant(sessionId),
    securityGenerationMarker(proof),
    "EX",
    CHANGE_GRANT_TTL_SECONDS,
  );
  return true;
}

export async function hasTwoFactorChangeGrant(
  sessionId: string,
  proof: SecurityGenerationProof,
): Promise<boolean> {
  return (
    (await getRedis().get(keys.twoFactorChangeGrant(sessionId))) ===
    securityGenerationMarker(proof)
  );
}

export async function clearTwoFactorChangeGrant(sessionId: string): Promise<void> {
  await getRedis().del(keys.twoFactorChangeGrant(sessionId));
}
