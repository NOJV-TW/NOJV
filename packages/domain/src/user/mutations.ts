import {
  courseMembershipRepo,
  runTransaction,
  userRepo,
  type TransactionClient,
} from "@nojv/db";
import { isReservedUsername } from "@nojv/core";

import { ConflictError, ForbiddenError, ValidationError } from "../shared/errors";

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
  input: EnsureUserInput = {},
) {
  const existing = await userRepo.withTx(tx).findById(userId);

  if (existing) {
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
    platformRole: input.platformRole ?? "student",
  });
}

const USERNAME_FORMAT_RE = /^[a-z0-9._-]+$/;
const USERNAME_MAX_LENGTH = 64;
const NAME_MAX_LENGTH = 64;

export async function renameName(userId: string, newName: string): Promise<void> {
  const trimmed = newName.trim();
  if (trimmed.length === 0 || trimmed.length > NAME_MAX_LENGTH) {
    throw new ValidationError("INVALID_NAME");
  }
  await userRepo.update(userId, { name: trimmed });
}

export async function setUserAvatar(userId: string, imageUrl: string | null): Promise<void> {
  await userRepo.update(userId, { image: imageUrl });
}

export async function markPasswordChanged(userId: string): Promise<void> {
  await userRepo.update(userId, { mustChangePassword: false });
}

export async function renameUsername(
  userId: string,
  newUsername: string,
): Promise<{ merged: boolean }> {
  return runTransaction(async (tx) => {
    const user = await userRepo.withTx(tx).findById(userId);
    if (!user) {
      throw new ForbiddenError("PLACEHOLDER_LOCKED");
    }
    if (user.status === "pending_first_login") {
      throw new ForbiddenError("PLACEHOLDER_LOCKED");
    }

    const current = user.username;
    if (current !== null && isReservedUsername(current)) {
      throw new ConflictError("VERIFIED_LOCKED");
    }

    const normalized = newUsername.trim().toLowerCase();
    if (
      normalized.length === 0 ||
      normalized.length > USERNAME_MAX_LENGTH ||
      !USERNAME_FORMAT_RE.test(normalized)
    ) {
      throw new ValidationError("INVALID_FORMAT");
    }
    if (isReservedUsername(normalized)) {
      throw new ConflictError("RESERVED_FORMAT");
    }

    if (normalized === current) {
      return { merged: false };
    }

    const conflict = await userRepo.withTx(tx).findByUsername(normalized);
    if (!conflict) {
      await userRepo.withTx(tx).update(userId, {
        username: normalized,
        displayUsername: normalized,
      });
      return { merged: false };
    }

    if (conflict.status === "pending_first_login") {
      const elevatedMembership = await courseMembershipRepo
        .withTx(tx)
        .findElevatedMembership(conflict.id);
      if (elevatedMembership) {
        throw new ConflictError("TAKEN");
      }

      await userRepo.attachPlaceholderInTx(tx, conflict.id, userId);
      await userRepo.withTx(tx).update(userId, {
        username: normalized,
        displayUsername: normalized,
      });
      return { merged: true };
    }

    throw new ConflictError("TAKEN");
  });
}
