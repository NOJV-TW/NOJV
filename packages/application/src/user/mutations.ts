import { runTransaction, userRepo } from "@nojv/db";
import { isReservedUsername, userHandleSchema } from "@nojv/core";

import { lockRosterIdentity, bindPendingMemberships } from "../course/roster";

import { ConflictError, ForbiddenError, ValidationError } from "../shared/errors";

const NAME_MAX_LENGTH = 64;

export interface DeleteUserResult {
  mode: "hard" | "soft";
  name: string;
}

export async function deleteUser(
  actorIsSuperAdmin: boolean,
  userId: string,
): Promise<DeleteUserResult | null> {
  return runTransaction(async (tx) => {
    await lockRosterIdentity(tx);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const users = userRepo.withTx(tx);
    const user = await users.findById(userId);
    if (!user) return null;

    const involvesAdmin = user.platformRole === "admin" || user.isSuperAdmin;
    if (involvesAdmin && !actorIsSuperAdmin) {
      throw new ForbiddenError("Only a super admin can delete an admin account.");
    }

    if (await tx.problem.count({ where: { authorId: userId } })) {
      throw new ConflictError(
        "Transfer ownership of this user's problems or delete unused drafts before deleting the account.",
      );
    }

    const blockers = await users.countDeletionBlockers(userId);
    if (blockers > 0) {
      await users.anonymizeAndDisable(userId);
      return { mode: "soft", name: user.name };
    }

    await users.delete(userId);
    return { mode: "hard", name: user.name };
  });
}

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

export async function claimOnboardingTour(
  userId: string,
  role: "student" | "teacher",
): Promise<boolean> {
  const result = await userRepo.claimOnboardingTour(userId, role);
  return result.count === 1;
}

export async function renameUsername(
  userId: string,
  newUsername: string,
): Promise<{ merged: boolean }> {
  const parsed = userHandleSchema.safeParse(newUsername);
  if (!parsed.success) throw new ValidationError("INVALID_FORMAT");
  const normalized = parsed.data;
  if (isReservedUsername(normalized)) throw new ConflictError("RESERVED_FORMAT");

  return runTransaction(async (tx) => {
    await lockRosterIdentity(tx);
    const user = await userRepo.withTx(tx).findById(userId);
    if (!user || user.disabled) throw new ForbiddenError("User is unavailable.");
    if (user.username && isReservedUsername(user.username)) {
      throw new ConflictError("VERIFIED_LOCKED");
    }
    const conflict = await userRepo.withTx(tx).findByUsername(normalized);
    if (conflict && conflict.id !== userId) throw new ConflictError("TAKEN");
    const linked = await bindPendingMemberships(tx, userId, normalized, false);
    await userRepo.withTx(tx).update(userId, {
      username: normalized,
      displayUsername: normalized,
    });
    return { merged: linked > 0 };
  });
}
