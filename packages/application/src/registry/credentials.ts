import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { registryCredentialRepo } from "@nojv/db";

import { assertCanCreateAdvancedProblems } from "../problem/permissions";
import type { RegistryPrincipal } from "./scopes";

export function hashRegistrySecret(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url");
}

function registrySecretsMatch(secret: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashRegistrySecret(secret));
  const stored = Buffer.from(storedHash);
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

const NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export function registryNamespaceFor(username: string | null, userId: string): string {
  const candidate = (username ?? "").toLowerCase();
  if (NAMESPACE_PATTERN.test(candidate)) return candidate;
  return `u-${userId.toLowerCase()}`;
}

export interface RegistryCredentialStatus {
  username: string;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt: Date | null;
}

export async function getRegistryCredentialStatus(
  userId: string,
): Promise<RegistryCredentialStatus | null> {
  const row = await registryCredentialRepo.findByUserId(userId);
  if (!row) return null;
  return {
    username: row.username,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastUsedAt: row.lastUsedAt,
  };
}

export interface GeneratedRegistryCredential {
  username: string;
  password: string;
}

export async function generateRegistryCredential(actor: {
  userId: string;
  username: string;
  platformRole: "admin" | "teacher" | "student";
}): Promise<GeneratedRegistryCredential> {
  await assertCanCreateAdvancedProblems(actor);

  const existing = await registryCredentialRepo.findByUserId(actor.userId);
  let username = existing?.username;
  if (!username) {
    const candidate = registryNamespaceFor(actor.username, actor.userId);
    const taken = await registryCredentialRepo.findByUsername(candidate);
    username =
      taken && taken.userId !== actor.userId ? `u-${actor.userId.toLowerCase()}` : candidate;
  }

  const password = randomBytes(24).toString("base64url");
  await registryCredentialRepo.upsertForUser(
    actor.userId,
    username,
    hashRegistrySecret(password),
  );

  return { username, password };
}

export async function verifyRegistryLogin(
  username: string,
  password: string,
): Promise<Extract<RegistryPrincipal, { kind: "teacher" }> | null> {
  const row = await registryCredentialRepo.findByUsername(username);
  if (!row) return null;
  if (!registrySecretsMatch(password, row.passwordHash)) return null;

  const user = row.user;
  if (user.disabled) return null;
  if (user.platformRole !== "admin" && !user.canCreateAdvancedProblems) return null;

  await registryCredentialRepo.markUsed(row.id);
  return { kind: "teacher", namespace: row.username };
}

export function verifyServiceAccountSecret(secret: string, storedHash: string): boolean {
  if (!storedHash) return false;
  return registrySecretsMatch(secret, storedHash);
}
