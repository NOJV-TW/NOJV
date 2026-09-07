import { createHash, randomBytes, randomInt } from "node:crypto";

import {
  prismaAdapterClient as prisma,
  securityFactorRepo,
  type SecurityFactorState,
} from "@nojv/db";
import { getRedis, keys } from "@nojv/redis";

import {
  isSecurityGenerationCurrent,
  securityGenerationMarker,
  type SecurityGenerationProof,
} from "./step-up";

const OTP_TTL_SECONDS = 600;
const OTP_MAX_ATTEMPTS = 5;
const SECURITY_SETTINGS_TTL_SECONDS = 600;
const PENDING_TOTP_TTL_SECONDS = 600;
const SUPER_ADMIN_PASSWORD_PROOF_TTL_SECONDS = 600;

const REBIND_SECURITY_SETTINGS = `
if redis.call("GET", KEYS[1]) ~= ARGV[1] then
  return 0
end
local ttl = redis.call("TTL", KEYS[1])
if ttl <= 0 then
  redis.call("DEL", KEYS[1])
  return 0
end
redis.call("SET", KEYS[1], ARGV[2], "EX", ttl)
return 1
`;

const VERIFY_SETUP_OTP_SCRIPT = `
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

const CONSUME_PENDING_TOTP = `
if redis.call("GET", KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call("DEL", KEYS[1])
return 1
`;

export interface SuperAdminPasswordProof extends SecurityGenerationProof {
  authenticatedAt: string;
  sessionId: string | null;
}

function parseSuperAdminPasswordProof(value: string): SuperAdminPasswordProof | null {
  try {
    const proof = JSON.parse(value) as Record<string, unknown>;
    if (
      typeof proof.userId !== "string" ||
      typeof proof.securityGeneration !== "number" ||
      !Number.isSafeInteger(proof.securityGeneration) ||
      typeof proof.authenticatedAt !== "string" ||
      (proof.sessionId !== null && typeof proof.sessionId !== "string") ||
      Number.isNaN(new Date(proof.authenticatedAt).getTime())
    ) {
      return null;
    }
    return proof as unknown as SuperAdminPasswordProof;
  } catch {
    return null;
  }
}

export function isSuperAdminPasswordProofSessionValid(
  proof: SuperAdminPasswordProof,
  sessionId: string | null,
): boolean {
  return proof.sessionId === null || proof.sessionId === sessionId;
}

export async function createSuperAdminPasswordProofTicket(
  proof: SuperAdminPasswordProof,
): Promise<string> {
  const ticket = randomBytes(32).toString("base64url");
  await getRedis().set(
    keys.superAdminPasswordProof(ticket),
    JSON.stringify(proof),
    "EX",
    SUPER_ADMIN_PASSWORD_PROOF_TTL_SECONDS,
  );
  return ticket;
}

export async function readSuperAdminPasswordProofTicket(
  ticket: string,
): Promise<SuperAdminPasswordProof | null> {
  const value = await getRedis().get(keys.superAdminPasswordProof(ticket));
  if (!value) return null;
  const proof = parseSuperAdminPasswordProof(value);
  return proof && (await isSecurityGenerationCurrent(proof)) ? proof : null;
}

export async function consumeSuperAdminPasswordProofTicket(
  ticket: string,
  userId: string,
): Promise<SuperAdminPasswordProof | null> {
  const value = await getRedis().getdel(keys.superAdminPasswordProof(ticket));
  if (!value) return null;
  const proof = parseSuperAdminPasswordProof(value);
  return proof?.userId === userId && (await isSecurityGenerationCurrent(proof)) ? proof : null;
}

export async function deleteSuperAdminPasswordProofTicket(ticket: string): Promise<void> {
  await getRedis().del(keys.superAdminPasswordProof(ticket));
}

export function generateSecuritySetupOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function hashOtp(otp: string): string {
  return createHash("sha256").update(otp).digest("base64url");
}

export function getSecurityFactorState(userId: string): Promise<SecurityFactorState | null> {
  return securityFactorRepo.getState(userId);
}

export function replaceTotpSecurityFactor(input: {
  backupCodes: string;
  expectedSecurityGeneration: number;
  secret: string;
  userId: string;
}) {
  return securityFactorRepo.replaceTotp(input);
}

export function removeTotpSecurityFactor(userId: string, expectedSecurityGeneration: number) {
  return securityFactorRepo.removeTotp(userId, expectedSecurityGeneration);
}

export function removePasskeySecurityFactor(
  userId: string,
  passkeyId: string,
  expectedSecurityGeneration: number,
) {
  return securityFactorRepo.removePasskey(userId, passkeyId, expectedSecurityGeneration);
}

export function replaceBackupCodes(
  userId: string,
  backupCodes: string,
  expectedSecurityGeneration: number,
) {
  return securityFactorRepo.replaceBackupCodes(userId, backupCodes, expectedSecurityGeneration);
}

export function resetSecurityFactorsForRecovery(
  userId: string,
  keepSessionId: string | null,
): Promise<SecurityFactorState> {
  return securityFactorRepo.resetForRecovery(userId, keepSessionId);
}

export async function storePendingTotpEnrollment(
  sessionId: string,
  payload: string,
): Promise<void> {
  await getRedis().set(keys.pendingTotp(sessionId), payload, "EX", PENDING_TOTP_TTL_SECONDS);
}

export function readPendingTotpEnrollment(sessionId: string): Promise<string | null> {
  return getRedis().get(keys.pendingTotp(sessionId));
}

export async function consumePendingTotpEnrollment(
  sessionId: string,
  payload: string,
): Promise<boolean> {
  return (
    Number(
      await getRedis().eval(CONSUME_PENDING_TOTP, 1, keys.pendingTotp(sessionId), payload),
    ) === 1
  );
}

export function findAdminSignInUser(identity: string) {
  return prisma.user.findFirst({
    where: identity.includes("@") ? { email: identity } : { username: identity },
    select: {
      id: true,
      isSuperAdmin: true,
      mustChangePassword: true,
      platformRole: true,
      securityGeneration: true,
    },
  });
}

export function getSuperAdminSecurityUser(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, id: true, isSuperAdmin: true, securityGeneration: true },
  });
}

export function findAuthSessionByToken(token: string) {
  return prisma.session.findUnique({
    where: { token },
    select: { createdAt: true, id: true, userId: true },
  });
}

export async function preserveSuperAdminSessionStart(
  sessionId: string,
  authenticatedAt: Date,
): Promise<void> {
  const maximumExpiry = new Date(authenticatedAt.getTime() + 24 * 60 * 60 * 1000);
  const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
  await prisma.session.update({
    where: { id: sessionId },
    data: {
      createdAt: authenticatedAt,
      expiresAt: session.expiresAt < maximumExpiry ? session.expiresAt : maximumExpiry,
    },
  });
}

export async function deleteAuthSession(sessionId: string): Promise<void> {
  await prisma.session.delete({ where: { id: sessionId } });
}

async function storeOtp(otpKey: string, attemptsKey: string, otp: string): Promise<void> {
  const redis = getRedis();
  await redis.set(otpKey, hashOtp(otp), "EX", OTP_TTL_SECONDS);
  await redis.del(attemptsKey);
}

export async function storeSecuritySetupOtp(userId: string, otp: string): Promise<void> {
  return storeOtp(keys.securitySetupOtp(userId), keys.securitySetupOtpAttempts(userId), otp);
}

export type SecuritySetupOtpResult =
  { ok: true } | { ok: false; reason: "expired" | "invalid" | "locked" };

async function verifyOtp(
  otpKey: string,
  attemptsKey: string,
  otp: string,
): Promise<SecuritySetupOtpResult> {
  const redis = getRedis();
  const outcome = Number(
    await redis.eval(
      VERIFY_SETUP_OTP_SCRIPT,
      2,
      otpKey,
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
  throw new Error(`Unexpected security setup OTP result: ${String(outcome)}`);
}

export function verifySecuritySetupOtp(
  userId: string,
  otp: string,
): Promise<SecuritySetupOtpResult> {
  return verifyOtp(keys.securitySetupOtp(userId), keys.securitySetupOtpAttempts(userId), otp);
}

export function storeSuperAdminRecoveryOtp(userId: string, otp: string): Promise<void> {
  return storeOtp(
    keys.superAdminRecoveryOtp(userId),
    keys.superAdminRecoveryOtpAttempts(userId),
    otp,
  );
}

export function verifySuperAdminRecoveryOtp(
  userId: string,
  otp: string,
): Promise<SecuritySetupOtpResult> {
  return verifyOtp(
    keys.superAdminRecoveryOtp(userId),
    keys.superAdminRecoveryOtpAttempts(userId),
    otp,
  );
}

export async function unlockSecuritySettings(
  sessionId: string,
  proof: SecurityGenerationProof,
): Promise<boolean> {
  if (!(await isSecurityGenerationCurrent(proof))) return false;
  await getRedis().set(
    keys.securitySettingsGrant(sessionId),
    securityGenerationMarker(proof),
    "EX",
    SECURITY_SETTINGS_TTL_SECONDS,
  );
  return true;
}

export async function areSecuritySettingsUnlocked(
  sessionId: string,
  proof: SecurityGenerationProof,
): Promise<boolean> {
  return (
    (await getRedis().get(keys.securitySettingsGrant(sessionId))) ===
    securityGenerationMarker(proof)
  );
}

export async function clearSecuritySettingsUnlock(sessionId: string): Promise<void> {
  await getRedis().del(keys.securitySettingsGrant(sessionId));
}

export async function rebindSecuritySettingsAfterSecurityChange(
  sessionId: string,
  previousProof: SecurityGenerationProof,
  currentProof: SecurityGenerationProof,
): Promise<boolean> {
  if (!(await isSecurityGenerationCurrent(currentProof))) return false;
  return (
    Number(
      await getRedis().eval(
        REBIND_SECURITY_SETTINGS,
        1,
        keys.securitySettingsGrant(sessionId),
        securityGenerationMarker(previousProof),
        securityGenerationMarker(currentProof),
      ),
    ) === 1
  );
}

export function passkeyRegistrationDenialReason(state: {
  securitySettingsUnlocked: boolean;
}): "security_settings_locked" | null {
  return state.securitySettingsUnlocked ? null : "security_settings_locked";
}
