import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { apiTokenRepo } from "@nojv/db";
import {
  apiTokenScopes,
  apiTokenScopeSchema,
  type ApiTokenScope,
  type PlatformRole,
} from "@nojv/core";

import { ForbiddenError, HttpError, NotFoundError, ValidationError } from "../shared/errors";
import { assertApiTokenRuleAccess, type MatchedApiTokenRouteRule } from "./acl";

const TOKEN_PREFIX = "nojv_live";
const PREFIX_BYTES = 8;
const SECRET_BYTES = 32;
const TOKEN_NAME_MAX = 80;
const EXPIRY_PRESETS = [30, 90, 365] as const;

export type ApiTokenExpiryDays = (typeof EXPIRY_PRESETS)[number];

export interface VerifiedApiTokenContext {
  actor: {
    displayName: string;
    email: string;
    emailVerified: boolean;
    platformRole: "admin" | "teacher" | "student";
    userId: string;
    username: string | null;
  };
  scopes: ApiTokenScope[];
  tokenId: string;
  tokenPrefix: string;
  route: MatchedApiTokenRouteRule;
  ip: string;
}

export interface ApiTokenListItem {
  createdAt: string;
  expiresAt: string;
  id: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  name: string;
  prefix: string;
  scopes: string[];
  status: "active" | "revoked";
}

export interface ApiTokenCreateResult {
  token: string;
  item: ApiTokenListItem;
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > TOKEN_NAME_MAX) {
    throw new ValidationError("Invalid API token name.");
  }
  return trimmed;
}

export function listAssignableApiTokenScopes(platformRole: PlatformRole): ApiTokenScope[] {
  return apiTokenScopes.filter((scope) => {
    if (scope.startsWith("admin:")) return platformRole === "admin";
    return true;
  });
}

function normalizeScopes(
  scopes: readonly string[],
  platformRole?: PlatformRole,
): ApiTokenScope[] {
  const result = [...new Set(scopes)].map((scope) => apiTokenScopeSchema.parse(scope));
  if (platformRole) {
    const allowed = new Set(listAssignableApiTokenScopes(platformRole));
    if (result.some((scope) => !allowed.has(scope))) {
      throw new ForbiddenError("Cannot assign API token scope for this role.");
    }
  }
  return result.sort();
}

function normalizeExpiryDays(days: number): ApiTokenExpiryDays {
  if (EXPIRY_PRESETS.includes(days as ApiTokenExpiryDays)) {
    return days as ApiTokenExpiryDays;
  }
  throw new ValidationError("Invalid API token expiry.");
}

function expiresAtFromDays(days: ApiTokenExpiryDays): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function buildToken(prefix: string, secret: string): string {
  return `${TOKEN_PREFIX}_${prefix}.${secret}`;
}

function generateTokenParts(): { prefix: string; secret: string; token: string } {
  const prefix = randomBytes(PREFIX_BYTES).toString("base64url");
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  return { prefix, secret, token: buildToken(prefix, secret) };
}

function parseToken(token: string): { prefix: string } | null {
  const match = new RegExp(`^${TOKEN_PREFIX}_([A-Za-z0-9_-]+)\\.[A-Za-z0-9_-]+$`).exec(token);
  if (!match) return null;
  const prefix = match[1];
  return prefix ? { prefix } : null;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function tokenHashMatches(storedHash: string, presentedHash: string): boolean {
  const stored = Buffer.from(storedHash);
  const presented = Buffer.from(presentedHash);
  return stored.length === presented.length && timingSafeEqual(stored, presented);
}

function toListItem(row: {
  createdAt: Date;
  expiresAt: Date;
  id: string;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  name: string;
  prefix: string;
  scopes: string[];
  status: "active" | "revoked";
}): ApiTokenListItem {
  return {
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    id: row.id,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    lastUsedIp: row.lastUsedIp,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes,
    status: row.status,
  };
}

export const expiryPresets = EXPIRY_PRESETS;

export async function createApiToken(input: {
  expiresInDays: number;
  name: string;
  platformRole: PlatformRole;
  scopes: readonly string[];
  userId: string;
}): Promise<ApiTokenCreateResult> {
  const name = normalizeName(input.name);
  const scopes = normalizeScopes(input.scopes, input.platformRole);
  const expiresAt = expiresAtFromDays(normalizeExpiryDays(input.expiresInDays));
  const generated = generateTokenParts();

  const row = await apiTokenRepo.create({
    expiresAt,
    name,
    prefix: generated.prefix,
    scopes,
    tokenHash: hashToken(generated.token),
    userId: input.userId,
  });

  return { item: toListItem(row), token: generated.token };
}

export async function listApiTokens(userId: string): Promise<ApiTokenListItem[]> {
  const rows = await apiTokenRepo.listForUser(userId);
  return rows.map(toListItem);
}

export async function updateApiToken(input: {
  expiresInDays: number;
  id: string;
  name: string;
  platformRole: PlatformRole;
  scopes: readonly string[];
  userId: string;
}): Promise<ApiTokenListItem> {
  await apiTokenRepo.updateForUser(input.id, input.userId, {
    expiresAt: expiresAtFromDays(normalizeExpiryDays(input.expiresInDays)),
    name: normalizeName(input.name),
    scopes: normalizeScopes(input.scopes, input.platformRole),
  });
  const row = await apiTokenRepo.findByIdForUser(input.id, input.userId);
  if (!row) throw new NotFoundError("API token not found.");
  return toListItem(row);
}

export async function rotateApiToken(input: {
  id: string;
  userId: string;
}): Promise<ApiTokenCreateResult> {
  const existing = await apiTokenRepo.findByIdForUser(input.id, input.userId);
  if (!existing) throw new NotFoundError("API token not found.");
  if (existing.status !== "active") throw new ForbiddenError("API token is revoked.");

  const generated = generateTokenParts();
  await apiTokenRepo.updateForUser(input.id, input.userId, {
    prefix: generated.prefix,
    tokenHash: hashToken(generated.token),
  });
  const row = await apiTokenRepo.findByIdForUser(input.id, input.userId);
  if (!row) throw new NotFoundError("API token not found.");
  return { item: toListItem(row), token: generated.token };
}

export async function revokeApiToken(input: {
  id: string;
  revokedById: string;
  userId: string;
}): Promise<ApiTokenListItem> {
  await apiTokenRepo.updateForUser(input.id, input.userId, {
    revokedAt: new Date(),
    revokedById: input.revokedById,
    status: "revoked",
  });
  const row = await apiTokenRepo.findByIdForUser(input.id, input.userId);
  if (!row) throw new NotFoundError("API token not found.");
  return toListItem(row);
}

export async function verifyApiTokenForRoute(input: {
  ip: string;
  route: MatchedApiTokenRouteRule;
  token: string;
}): Promise<VerifiedApiTokenContext> {
  const parsed = parseToken(input.token);
  if (!parsed) throw new HttpError("Invalid API token.", 401);

  const row = await apiTokenRepo.findByPrefix(parsed.prefix);
  if (!row || !tokenHashMatches(row.tokenHash, hashToken(input.token))) {
    throw new HttpError("Invalid API token.", 401);
  }
  if (row.status !== "active") throw new HttpError("API token has been revoked.", 401);
  if (row.expiresAt.getTime() <= Date.now()) {
    throw new HttpError("API token has expired.", 401);
  }
  if (row.user.disabled || row.user.status !== "active") {
    throw new HttpError("API token owner is disabled.", 401);
  }

  const scopes = normalizeScopes(row.scopes);
  assertApiTokenRuleAccess({
    actorRole: row.user.platformRole,
    rule: input.route,
    scopes,
  });

  return {
    actor: {
      displayName: row.user.name,
      email: row.user.email,
      emailVerified: row.user.emailVerified,
      platformRole: row.user.platformRole,
      userId: row.user.id,
      username: row.user.username,
    },
    ip: input.ip,
    route: input.route,
    scopes,
    tokenId: row.id,
    tokenPrefix: row.prefix,
  };
}

export async function recordApiTokenUse(input: { ip: string; tokenId: string }): Promise<void> {
  await apiTokenRepo.markUsed(input.tokenId, input.ip);
}
