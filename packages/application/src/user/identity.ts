import { runTransaction, type TransactionClient } from "@nojv/db";
import { isCanonicalSchoolUsername } from "@nojv/core";

import { bindPendingMemberships, lockRosterIdentity } from "../course/roster";
import { ConflictError, ForbiddenError, ValidationError } from "../shared/errors";

export async function setVerifiedUsername(
  tx: TransactionClient,
  userId: string,
  username: string,
  schoolEmail?: string,
): Promise<void> {
  if (!isCanonicalSchoolUsername(username))
    throw new ValidationError("Invalid school username.");
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user || user.disabled) throw new ForbiddenError("User is unavailable.");
  const conflict = await tx.user.findUnique({ where: { username } });
  if (conflict && conflict.id !== userId) throw new ConflictError("此學號已被其他帳號使用");
  await bindPendingMemberships(tx, userId, username, true);
  await tx.user.update({
    where: { id: userId },
    data: {
      username,
      displayUsername: username,
      ...(schoolEmail ? { schoolEmail, schoolVerifiedAt: new Date() } : {}),
    },
  });
}

export async function linkUserCourseRoster(userId: string): Promise<void> {
  await runTransaction(async (tx) => {
    await lockRosterIdentity(tx);
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.disabled) throw new ForbiddenError("User is unavailable.");
    if (user.username) {
      await bindPendingMemberships(
        tx,
        userId,
        user.username,
        isCanonicalSchoolUsername(user.username),
      );
    }
  });
}
