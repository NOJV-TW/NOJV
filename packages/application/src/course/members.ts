import {
  courseMembershipAdminRepo,
  courseMembershipRepo,
  runTransaction,
  type TransactionClient,
} from "@nojv/db";
import {
  isCanonicalSchoolUsername,
  isReservedUsername,
  userHandleSchema,
  type CourseRole,
  type EffectiveCourseRole,
} from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../shared/errors";
import { canManageCourse, resolveEffectiveCourseRole } from "../shared/permissions";
import { requireCourse } from "../shared/require";
import * as notificationDomain from "../notification";
import { bindPendingMemberships, lockCourseMembers, lockRosterIdentity } from "./roster";

async function resolveActorCourseRoleTx(
  tx: TransactionClient,
  actor: ActorContext,
  courseId: string,
): Promise<EffectiveCourseRole | null> {
  const membership = await courseMembershipRepo
    .withTx(tx)
    .findByComposite(courseId, actor.userId);
  return resolveEffectiveCourseRole(
    actor.platformRole,
    membership?.status === "active" ? membership.role : null,
  );
}

export interface CourseMemberRow {
  membershipId: string;
  userId: string | null;
  name: string;
  username: string | null;
  image: string | null;
  email: string | null;
  role: CourseRole;
  status: "active" | "removed";
  isPending: boolean;
  joinedAt: string;
  removedAt: string | null;
}

export async function listMembersForCourse(courseId: string): Promise<CourseMemberRow[]> {
  const rows = await courseMembershipAdminRepo.listWithUserByCourse(courseId);
  return rows.map((row) => ({
    membershipId: row.id,
    userId: row.userId,
    name: row.user?.name ?? row.pendingUsername ?? "",
    username: row.user?.username ?? row.pendingUsername,
    image: row.user?.image ?? null,
    email: row.user?.email ?? null,
    role: row.role,
    status: row.status,
    isPending: row.userId === null,
    joinedAt: row.joinedAt.toISOString(),
    removedAt: row.removedAt?.toISOString() ?? null,
  }));
}

export function parseHandleInput(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\s,;]+/)
        .map((token) => token.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export interface BulkAddResult {
  added: number;
  pendingCreated: number;
  skipped: number;
  reactivated: number;
}

function validateRosterUsername(handle: string): void {
  if (
    !userHandleSchema.safeParse(handle).success ||
    (isReservedUsername(handle) && !isCanonicalSchoolUsername(handle))
  ) {
    throw new ValidationError(
      "Use a valid username: NTNU student ID, ntu_ student ID, ntust_ student ID, or a general username.",
    );
  }
}

export async function bulkAddByHandle(
  actor: ActorContext,
  courseId: string,
  payload: { handles: string[]; role: CourseRole },
): Promise<BulkAddResult> {
  const handles = [
    ...new Set(payload.handles.map((handle) => handle.trim().toLowerCase())),
  ].filter(Boolean);
  if (handles.length === 0) throw new ValidationError("Enter at least one username.");
  handles.forEach(validateRosterUsername);
  return runTransaction(async (tx) => {
    await lockRosterIdentity(tx);
    const users = await tx.user.findMany({
      where: { username: { in: handles } },
      select: { id: true, username: true },
    });
    for (const user of users) {
      if (user.username)
        await bindPendingMemberships(
          tx,
          user.id,
          user.username,
          isCanonicalSchoolUsername(user.username),
        );
    }
    await lockCourseMembers(tx, courseId);
    const course = await requireCourse(tx, courseId);
    const actorRole = await resolveActorCourseRoleTx(tx, actor, courseId);
    if (
      !canManageCourse(actorRole) ||
      (payload.role === "ta" && actorRole !== "teacher" && actorRole !== "admin") ||
      (payload.role === "teacher" && actorRole !== "admin")
    ) {
      throw new ForbiddenError("You cannot add members with this role.");
    }
    const usersByHandle = new Map(users.map((user) => [user.username, user.id]));
    const existing = await tx.courseMembership.findMany({ where: { courseId } });
    const existingByUser = new Map(
      existing.filter((row) => row.userId !== null).map((row) => [row.userId, row]),
    );
    const existingByHandle = new Map(
      existing
        .filter((row) => row.pendingUsername !== null)
        .map((row) => [row.pendingUsername, row]),
    );
    const now = new Date();
    const additions: {
      courseId: string;
      userId: string | null;
      pendingUsername: string | null;
      role: CourseRole;
      addedByUserId: string;
      joinedAt: Date;
    }[] = [];
    const restored: string[] = [];
    let skipped = 0;
    let pendingCreated = 0;
    for (const handle of handles) {
      const userId = usersByHandle.get(handle) ?? null;
      const member = userId ? existingByUser.get(userId) : existingByHandle.get(handle);
      if (member?.status === "active") {
        skipped++;
        continue;
      }
      if (member) {
        if (member.role === "teacher" && actorRole !== "admin")
          throw new ForbiddenError("Only an admin can restore another teacher.");
        restored.push(member.id);
      } else {
        additions.push({
          courseId: course.id,
          userId,
          pendingUsername: userId ? null : handle,
          role: payload.role,
          joinedAt: now,
          addedByUserId: actor.userId,
        });
        if (!userId) pendingCreated++;
      }
    }
    const members = restored.length
      ? await tx.courseMembership.updateManyAndReturn({
          where: { id: { in: restored } },
          data: {
            role: payload.role,
            status: "active",
            joinedAt: now,
            removedAt: null,
            addedByUserId: actor.userId,
          },
        })
      : [];
    if (additions.length)
      members.push(...(await tx.courseMembership.createManyAndReturn({ data: additions })));
    if (payload.role === "student") {
      for (const member of members) {
        if (!member.userId) continue;
        await notificationDomain.createNotificationInTransaction(tx, {
          userId: member.userId,
          type: "course_enrolled",
          params: { courseId, courseName: course.title },
          linkUrl: `/courses/${courseId}`,
          dedupeKey: `course_enrolled:${member.id}:${member.joinedAt.toISOString()}`,
        });
      }
    }
    return {
      added: additions.length + restored.length,
      pendingCreated,
      skipped,
      reactivated: restored.length,
    };
  });
}

async function requireManagedMember(
  tx: TransactionClient,
  actor: ActorContext,
  courseId: string,
  membershipId: string,
) {
  await lockCourseMembers(tx, courseId);
  const actorRole = await resolveActorCourseRoleTx(tx, actor, courseId);
  if (actorRole !== "admin" && actorRole !== "teacher")
    throw new ForbiddenError("Only teachers or admins can manage members.");
  const member = await tx.courseMembership.findUnique({
    where: { id: membershipId, courseId },
    include: { course: { select: { ownerId: true } } },
  });
  if (!member) throw new NotFoundError("Course member not found.");
  if (member.userId === member.course.ownerId)
    throw new ForbiddenError("The course owner must remain a teacher.");
  if (actorRole === "teacher" && (member.userId === actor.userId || member.role === "teacher"))
    throw new ForbiddenError(
      "Teachers cannot change their own or another teacher's membership.",
    );
  return { member, actorRole };
}

export async function changeMemberRole(
  actor: ActorContext,
  courseId: string,
  membershipId: string,
  role: CourseRole,
) {
  return runTransaction(async (tx) => {
    const { actorRole } = await requireManagedMember(tx, actor, courseId, membershipId);
    if (role === "teacher" && actorRole !== "admin")
      throw new ForbiddenError("Only an admin can promote a member to teacher.");
    return courseMembershipAdminRepo.withTx(tx).updateRole(courseId, membershipId, role);
  });
}

export async function correctPendingUsername(
  actor: ActorContext,
  courseId: string,
  membershipId: string,
  username: string,
) {
  const normalized = username.trim().toLowerCase();
  validateRosterUsername(normalized);
  return runTransaction(async (tx) => {
    await lockRosterIdentity(tx);
    const { member } = await requireManagedMember(tx, actor, courseId, membershipId);
    if (member.userId !== null) throw new ConflictError("ROSTER_ALREADY_LINKED");
    const user = await tx.user.findUnique({ where: { username: normalized } });
    if (user?.disabled) throw new ConflictError("ROSTER_ACCOUNT_UNAVAILABLE");
    const conflict = await tx.courseMembership.findFirst({
      where: {
        courseId,
        id: { not: membershipId },
        OR: [{ pendingUsername: normalized }, ...(user ? [{ userId: user.id }] : [])],
      },
    });
    if (conflict) throw new ConflictError("ROSTER_USERNAME_CONFLICT");
    await tx.courseMembership.update({
      where: { id: membershipId },
      data: { pendingUsername: normalized },
    });
    if (user) {
      await bindPendingMemberships(
        tx,
        user.id,
        normalized,
        isCanonicalSchoolUsername(normalized),
        courseId,
      );
    }
  });
}

export async function removeMember(
  actor: ActorContext,
  courseId: string,
  membershipId: string,
) {
  return runTransaction(async (tx) => {
    await requireManagedMember(tx, actor, courseId, membershipId);
    return courseMembershipAdminRepo.withTx(tx).removeFromCourse(courseId, membershipId);
  });
}
