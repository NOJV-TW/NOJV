import { randomBytes } from "node:crypto";

import { accountRepo } from "@nojv/db";
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

export async function markAdminSessionMfa(sessionId: string): Promise<void> {
  await getRedis().set(keys.adminSessionMfa(sessionId), "1", "EX", ADMIN_MFA_TTL_SECONDS);
}

export async function hasAdminSessionMfa(sessionId: string): Promise<boolean> {
  return (await getRedis().get(keys.adminSessionMfa(sessionId))) !== null;
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

export async function markAdminMode(sessionId: string): Promise<void> {
  await getRedis().set(keys.adminMode(sessionId), "1", "EX", ADMIN_MFA_TTL_SECONDS);
}

export async function hasAdminMode(sessionId: string): Promise<boolean> {
  return (await getRedis().get(keys.adminMode(sessionId))) !== null;
}

export async function clearAdminMode(sessionId: string): Promise<void> {
  await getRedis().del(keys.adminMode(sessionId));
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
