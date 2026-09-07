import { runTransaction, type TransactionClient } from "@nojv/db";
import { extractStudentId, isCanonicalSchoolUsername, parseSchoolEmail } from "@nojv/core";

import { bindPendingMemberships, lockRosterIdentity } from "../course/roster";
import { ConflictError, ForbiddenError, ValidationError } from "../shared/errors";

export async function setVerifiedUsername(
  tx: TransactionClient,
  userId: string,
  username: string,
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
    data: { username, displayUsername: username },
  });
}

export async function linkUserCourseRoster(userId: string): Promise<void> {
  await runTransaction(async (tx) => {
    await lockRosterIdentity(tx);
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.disabled) throw new ForbiddenError("User is unavailable.");
    if (user.username && isCanonicalSchoolUsername(user.username)) {
      await bindPendingMemberships(tx, userId, user.username, true);
      return;
    }
    const school = user.emailVerified ? parseSchoolEmail(user.email) : null;
    if (school) {
      await setVerifiedUsername(tx, userId, extractStudentId(school.school, school.studentId));
    } else if (user.username) {
      await bindPendingMemberships(tx, userId, user.username, false);
    }
  });
}
