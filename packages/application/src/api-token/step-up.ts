import { randomBytes } from "node:crypto";

import { accountRepo, userRepo } from "@nojv/db";
import { getRedis, keys } from "@nojv/redis";

const STEPUP_TTL_SECONDS = 600;
const STEPUP_HANDOFF_TICKET_TTL_SECONDS = 60;
const ADMIN_MFA_TTL_SECONDS = 604800;
const TOKEN_PAGE_MFA_TTL_SECONDS = 3600;
const OTP_DEDUPE_TTL_SECONDS = 120;
const SUPER_ADMIN_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TOTP_CODE_LENGTH = 6;

const STEPUP_CODE_PATTERN = new RegExp(`^\\d{${String(TOTP_CODE_LENGTH)}}$`);
const BACKUP_CODE_PATTERN = /^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/;

const GRANT_ADMIN_ELEVATION = `
if redis.call("GET", KEYS[1]) ~= ARGV[1] then
  return 0
end
if redis.call("EXISTS", KEYS[2]) == 0 then
  return 0
end
redis.call("SET", KEYS[3], ARGV[1], "EX", ARGV[2])
return 1
`;

const RESOLVE_ADMIN_ELEVATION = `
local mode = redis.call("GET", KEYS[2])
if not mode then
  return 0
end
if redis.call("GET", KEYS[1]) == ARGV[1] and mode == ARGV[1] then
  return 1
end
redis.call("DEL", KEYS[1], KEYS[2])
return 0
`;

const REVOKE_ADMIN_ELEVATION = `
return redis.call("DEL", KEYS[1], KEYS[2])
`;

export function validateStepUpCode(code: string): boolean {
  return STEPUP_CODE_PATTERN.test(code);
}

export function isBackupCodeFormat(code: string): boolean {
  return BACKUP_CODE_PATTERN.test(code);
}

export async function markStepUpFresh(sessionId: string): Promise<void> {
  await getRedis().set(keys.apiTokenStepUp(sessionId), "1", "EX", STEPUP_TTL_SECONDS);
}

export async function hasFreshStepUp(sessionId: string): Promise<boolean> {
  return (await getRedis().get(keys.apiTokenStepUp(sessionId))) !== null;
}

export async function clearStepUp(sessionId: string): Promise<void> {
  await getRedis().del(keys.apiTokenStepUp(sessionId));
}

export async function createStepUpHandoffTicket(userId: string): Promise<string> {
  const ticket = randomBytes(32).toString("base64url");
  await getRedis().set(
    keys.stepUpHandoffTicket(ticket),
    userId,
    "EX",
    STEPUP_HANDOFF_TICKET_TTL_SECONDS,
  );
  return ticket;
}

export function consumeStepUpHandoffTicket(ticket: string): Promise<string | null> {
  return getRedis().getdel(keys.stepUpHandoffTicket(ticket));
}

export async function markAdminSessionMfa(sessionId: string, userId: string): Promise<void> {
  await getRedis().set(keys.adminSessionMfa(sessionId), userId, "EX", ADMIN_MFA_TTL_SECONDS);
}

export async function hasAdminSessionMfa(sessionId: string, userId: string): Promise<boolean> {
  return (await getRedis().get(keys.adminSessionMfa(sessionId))) === userId;
}

export async function markTokenPageMfa(sessionId: string): Promise<void> {
  await getRedis().set(keys.tokenPageMfa(sessionId), "1", "EX", TOKEN_PAGE_MFA_TTL_SECONDS);
}

export async function hasTokenPageMfa(sessionId: string): Promise<boolean> {
  return (await getRedis().get(keys.tokenPageMfa(sessionId))) !== null;
}

export async function clearTokenPageMfa(sessionId: string): Promise<void> {
  await getRedis().del(keys.tokenPageMfa(sessionId));
}

export function isSuperAdminSessionExpired(createdAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - createdAt.getTime() > SUPER_ADMIN_SESSION_MAX_AGE_MS;
}

async function isAdminElevationEligible(userId: string): Promise<boolean> {
  const user = await userRepo.findById(userId);
  return user?.platformRole === "admin" && !user.disabled && user.twoFactorActivated;
}

export async function grantAdminElevation(sessionId: string, userId: string): Promise<boolean> {
  if (!(await isAdminElevationEligible(userId))) {
    await revokeAdminElevation(sessionId);
    return false;
  }
  const result = await getRedis().eval(
    GRANT_ADMIN_ELEVATION,
    3,
    keys.adminSessionMfa(sessionId),
    keys.apiTokenStepUp(sessionId),
    keys.adminMode(sessionId),
    userId,
    ADMIN_MFA_TTL_SECONDS,
  );
  return result === 1;
}

export async function resolveAdminElevation(
  sessionId: string,
  userId: string,
): Promise<boolean> {
  if (!(await isAdminElevationEligible(userId))) {
    await revokeAdminElevation(sessionId);
    return false;
  }
  const result = await getRedis().eval(
    RESOLVE_ADMIN_ELEVATION,
    2,
    keys.adminSessionMfa(sessionId),
    keys.adminMode(sessionId),
    userId,
  );
  return result === 1;
}

export async function revokeAdminElevation(sessionId: string): Promise<void> {
  await getRedis().eval(
    REVOKE_ADMIN_ELEVATION,
    2,
    keys.adminSessionMfa(sessionId),
    keys.adminMode(sessionId),
  );
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
