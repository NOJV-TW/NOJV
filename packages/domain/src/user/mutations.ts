import { userRepo, type TransactionClient } from "@nojv/db";

// --- Shared helpers ---

export interface EnsureUserInput {
  displayName?: string;
  email?: string;
  username?: string;
  platformRole?: "admin" | "student" | "teacher";
}

function sanitizeIdentitySegment(value: string) {
  const normalized = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : "local-user";
}

function createLocalEmail(userId: string) {
  return `${sanitizeIdentitySegment(userId)}@local.nojv.dev`;
}

function createLocalDisplayName(userId: string) {
  return `Local ${userId.replaceAll(/[_-]+/g, " ")}`;
}

function createLocalUsername(userId: string) {
  return sanitizeIdentitySegment(userId);
}

export async function ensureUser(
  tx: TransactionClient,
  userId: string,
  input: EnsureUserInput = {}
) {
  const existing = await userRepo.withTx(tx).findById(userId);

  if (existing) {
    // Only update fields explicitly provided — never overwrite with fallbacks
    const updates: Record<string, string> = {};
    if (input.displayName) updates.name = input.displayName;
    if (input.email) updates.email = input.email;
    if (input.username) updates.username = input.username;
    if (input.platformRole) updates.platformRole = input.platformRole;

    if (Object.keys(updates).length === 0) return existing;

    return userRepo.withTx(tx).update(existing.id, updates);
  }

  return userRepo.withTx(tx).create({
    id: userId,
    name: input.displayName ?? createLocalDisplayName(userId),
    email: input.email ?? createLocalEmail(userId),
    username: input.username ?? createLocalUsername(userId),
    platformRole: input.platformRole ?? "student"
  });
}
