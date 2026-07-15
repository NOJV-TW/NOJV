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
const SECURITY_MARKER_PREFIX = "sg1";

const MARK_VERIFIED_SESSION = `
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
redis.call("SET", KEYS[2], ARGV[1], "EX", ARGV[3])
if ARGV[4] == "1" then
  redis.call("SET", KEYS[3], ARGV[1], "EX", ARGV[5])
end
return 1
`;

const GRANT_ADMIN_ELEVATION = `
if ARGV[3] == "1" then
  if redis.call("GET", KEYS[1]) ~= ARGV[1] then
    return 0
  end
  if redis.call("GET", KEYS[2]) ~= ARGV[1] then
    return 0
  end
end
redis.call("SET", KEYS[3], ARGV[1], "EX", ARGV[2])
return 1
`;

const RESOLVE_ADMIN_ELEVATION = `
local mode = redis.call("GET", KEYS[2])
if not mode then
  return 0
end
if mode == ARGV[1] and (ARGV[2] == "0" or redis.call("GET", KEYS[1]) == ARGV[1]) then
  return 1
end
redis.call("DEL", KEYS[1], KEYS[2])
return 0
`;

export interface SecurityGenerationProof {
  securityGeneration: number;
  userId: string;
}

export interface AdminElevationPrincipal extends SecurityGenerationProof {
  disabled: boolean;
  isSuperAdmin: boolean;
  platformRole: "admin" | "teacher" | "student";
  twoFactorActivated: boolean;
}

export function securityGenerationProof(user: {
  id: string;
  securityGeneration: number;
}): SecurityGenerationProof {
  return { userId: user.id, securityGeneration: user.securityGeneration };
}

export function adminElevationPrincipal(user: {
  disabled: boolean;
  id: string;
  isSuperAdmin: boolean;
  platformRole: "admin" | "teacher" | "student";
  securityGeneration: number;
  twoFactorActivated: boolean;
}): AdminElevationPrincipal {
  return {
    ...securityGenerationProof(user),
    disabled: user.disabled,
    isSuperAdmin: user.isSuperAdmin,
    platformRole: user.platformRole,
    twoFactorActivated: user.twoFactorActivated,
  };
}

export function securityGenerationMarker(proof: SecurityGenerationProof): string {
  return `${SECURITY_MARKER_PREFIX}:${proof.userId}:${String(proof.securityGeneration)}`;
}

export function isSecurityGenerationCurrent(proof: SecurityGenerationProof): Promise<boolean> {
  return userRepo.securityGenerationMatches(proof.userId, proof.securityGeneration);
}

function parseSecurityGenerationProof(value: string): SecurityGenerationProof | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      typeof parsed.userId !== "string" ||
      typeof parsed.securityGeneration !== "number" ||
      !Number.isSafeInteger(parsed.securityGeneration) ||
      parsed.securityGeneration < 0
    ) {
      return null;
    }
    return {
      userId: parsed.userId,
      securityGeneration: parsed.securityGeneration,
    };
  } catch {
    return null;
  }
}

export function validateStepUpCode(code: string): boolean {
  return STEPUP_CODE_PATTERN.test(code);
}

export async function hasFreshStepUp(
  sessionId: string,
  proof: SecurityGenerationProof,
): Promise<boolean> {
  return (
    (await getRedis().get(keys.apiTokenStepUp(sessionId))) === securityGenerationMarker(proof)
  );
}

export async function clearStepUp(sessionId: string): Promise<void> {
  await getRedis().del(keys.apiTokenStepUp(sessionId));
}

export async function createStepUpHandoffTicket(
  proof: SecurityGenerationProof,
): Promise<string> {
  const ticket = randomBytes(32).toString("base64url");
  await getRedis().set(
    keys.stepUpHandoffTicket(ticket),
    JSON.stringify(proof),
    "EX",
    STEPUP_HANDOFF_TICKET_TTL_SECONDS,
  );
  return ticket;
}

export async function consumeStepUpHandoffTicket(
  ticket: string,
): Promise<SecurityGenerationProof | null> {
  const value = await getRedis().getdel(keys.stepUpHandoffTicket(ticket));
  return value === null ? null : parseSecurityGenerationProof(value);
}

export async function markVerifiedSession(
  sessionId: string,
  proof: SecurityGenerationProof,
  adminMfa: boolean,
): Promise<boolean> {
  if (!(await isSecurityGenerationCurrent(proof))) return false;
  await getRedis().eval(
    MARK_VERIFIED_SESSION,
    3,
    keys.apiTokenStepUp(sessionId),
    keys.tokenPageMfa(sessionId),
    keys.adminSessionMfa(sessionId),
    securityGenerationMarker(proof),
    STEPUP_TTL_SECONDS,
    TOKEN_PAGE_MFA_TTL_SECONDS,
    adminMfa ? "1" : "0",
    ADMIN_MFA_TTL_SECONDS,
  );
  return true;
}

export async function hasAdminSessionMfa(
  sessionId: string,
  proof: SecurityGenerationProof,
): Promise<boolean> {
  return (
    (await getRedis().get(keys.adminSessionMfa(sessionId))) === securityGenerationMarker(proof)
  );
}

export async function hasTokenPageMfa(
  sessionId: string,
  proof: SecurityGenerationProof,
): Promise<boolean> {
  return (
    (await getRedis().get(keys.tokenPageMfa(sessionId))) === securityGenerationMarker(proof)
  );
}

export function isSuperAdminSessionExpired(createdAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - createdAt.getTime() > SUPER_ADMIN_SESSION_MAX_AGE_MS;
}

export async function grantAdminElevation(
  sessionId: string,
  principal: AdminElevationPrincipal,
): Promise<boolean> {
  if (
    principal.platformRole !== "admin" ||
    principal.disabled ||
    (principal.isSuperAdmin && !principal.twoFactorActivated) ||
    !(await isSecurityGenerationCurrent(principal))
  ) {
    await revokeAdminElevation(sessionId);
    return false;
  }
  const marker = securityGenerationMarker(principal);
  const result = await getRedis().eval(
    GRANT_ADMIN_ELEVATION,
    3,
    keys.adminSessionMfa(sessionId),
    keys.apiTokenStepUp(sessionId),
    keys.adminMode(sessionId),
    marker,
    ADMIN_MFA_TTL_SECONDS,
    principal.isSuperAdmin ? "1" : "0",
  );
  return result === 1;
}

export async function resolveAdminElevation(
  sessionId: string,
  principal: AdminElevationPrincipal,
): Promise<boolean> {
  if (
    principal.platformRole !== "admin" ||
    principal.disabled ||
    (principal.isSuperAdmin && !principal.twoFactorActivated)
  ) {
    await revokeAdminElevation(sessionId);
    return false;
  }
  const marker = securityGenerationMarker(principal);
  const result = await getRedis().eval(
    RESOLVE_ADMIN_ELEVATION,
    2,
    keys.adminSessionMfa(sessionId),
    keys.adminMode(sessionId),
    marker,
    principal.isSuperAdmin ? "1" : "0",
  );
  return result === 1;
}

export async function revokeAdminElevation(sessionId: string): Promise<void> {
  await getRedis().del(keys.adminSessionMfa(sessionId), keys.adminMode(sessionId));
}

export async function consumeTotpCode(userId: string, code: string): Promise<boolean> {
  const result = await getRedis().set(
    keys.twoFactorTotpSeen(userId, code),
    "1",
    "EX",
    OTP_DEDUPE_TTL_SECONDS,
    "NX",
  );
  return result === "OK";
}

export function userHasCredentialPassword(userId: string): Promise<boolean> {
  return accountRepo.hasCredentialPassword(userId);
}
