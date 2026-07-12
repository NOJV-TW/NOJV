import { randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";

import { registryCredentialRepo } from "@nojv/db";

import { assertCanCreateAdvancedProblems } from "../problem/permissions";
import type { RegistryPrincipal } from "./scopes";

const BCRYPT_ROUNDS = 12;

export function hashRegistrySecret(secret: string): Promise<string> {
  return bcrypt.hash(secret, BCRYPT_ROUNDS);
}

function registrySecretsMatch(secret: string, storedHash: string): Promise<boolean> {
  if (!storedHash) return Promise.resolve(false);
  return bcrypt.compare(secret, storedHash);
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
    await hashRegistrySecret(password),
  );

  return { username, password };
}

export async function verifyRegistryLogin(
  username: string,
  password: string,
): Promise<Extract<RegistryPrincipal, { kind: "teacher" }> | null> {
  const row = await registryCredentialRepo.findByUsername(username);
  if (!row) return null;
  if (!(await registrySecretsMatch(password, row.passwordHash))) return null;

  const user = row.user;
  if (user.disabled) return null;
  if (user.platformRole !== "admin" && !user.canCreateAdvancedProblems) return null;

  await registryCredentialRepo.markUsed(row.id);
  return { kind: "teacher", namespace: row.username };
}

export function verifyServiceAccountSecret(
  secret: string,
  storedHash: string,
): Promise<boolean> {
  return registrySecretsMatch(secret, storedHash);
}
