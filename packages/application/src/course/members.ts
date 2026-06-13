import {
  courseMembershipAdminRepo,
  courseMembershipRepo,
  runTransaction,
  userRepo,
  type TransactionClient,
} from "@nojv/db";
import type { CourseRole, EffectiveCourseRole } from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import { ForbiddenError } from "../shared/errors";
import { resolveEffectiveCourseRole } from "../shared/permissions";
import { requireCourse } from "../shared/require";

async function resolveActorCourseRole(
  actor: ActorContext,
  courseId: string,
): Promise<EffectiveCourseRole | null> {
  const membership = await courseMembershipRepo.findByComposite(courseId, actor.userId);
  const courseRole = membership?.status === "active" ? membership.role : null;
  return resolveEffectiveCourseRole(actor.platformRole, courseRole);
}

async function resolveActorCourseRoleTx(
  tx: TransactionClient,
  actor: ActorContext,
  courseId: string,
): Promise<EffectiveCourseRole | null> {
  const membership = await courseMembershipRepo
    .withTx(tx)
    .findByComposite(courseId, actor.userId);
  const courseRole = membership?.status === "active" ? membership.role : null;
  return resolveEffectiveCourseRole(actor.platformRole, courseRole);
}

async function activeMemberRoleTx(
  tx: TransactionClient,
  courseId: string,
  userId: string,
): Promise<CourseRole | null> {
  const membership = await courseMembershipRepo.withTx(tx).findByComposite(courseId, userId);
  return membership?.status === "active" ? membership.role : null;
}

async function lockCourseMembers(tx: TransactionClient, courseId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`course-members:${courseId}`}, 0))`;
}

export interface CourseMemberRow {
  userId: string;
  name: string;
  username: string | null;
  email: string;
  role: CourseRole;
  status: "active" | "removed";
  isPlaceholder: boolean;
  joinedAt: string;
  removedAt: string | null;
}

export async function listMembersForCourse(courseId: string): Promise<CourseMemberRow[]> {
  const rows = await courseMembershipAdminRepo.listWithUserByCourse(courseId);
  return rows.map((row) => ({
    userId: row.user.id,
    name: row.user.name,
    username: row.user.username,
    email: row.user.email,
    role: row.role,
    status: row.status,
    isPlaceholder: row.user.status === "pending_first_login",
    joinedAt: row.joinedAt.toISOString(),
    removedAt: row.removedAt?.toISOString() ?? null,
  }));
}

export function parseHandleInput(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw.split(/[\s,;]+/)) {
    const handle = token.trim().toLowerCase();
    if (!handle) continue;
    if (seen.has(handle)) continue;
    seen.add(handle);
    out.push(handle);
  }
  return out;
}

export interface BulkAddResult {
  added: number;
  placeholdersCreated: number;
  skipped: number;
  reactivated: number;
}

export async function bulkAddByHandle(
  actor: ActorContext,
  courseId: string,
  payload: { handles: string[]; role: CourseRole },
): Promise<BulkAddResult> {
  if (payload.role === "ta") {
    const actorRole = await resolveActorCourseRole(actor, courseId);
    if (actorRole !== "admin" && actorRole !== "teacher") {
      throw new ForbiddenError("Only teachers or admins can add teaching assistants.");
    }
  }

  const uniqueHandles = Array.from(
    new Set(payload.handles.map((h) => h.trim().toLowerCase())),
  ).filter((h) => h.length > 0);

  return runTransaction(async (tx) => {
    const course = await requireCourse(tx, courseId);
    const now = new Date();
    let added = 0;
    let placeholdersCreated = 0;
    let skipped = 0;
    let reactivated = 0;

    for (const handle of uniqueHandles) {
      let user = await userRepo.withTx(tx).findByUsername(handle);

      if (!user) {
        user = await createPlaceholderInTx(tx, handle);
        placeholdersCreated += 1;
      }

      const existing = await courseMembershipRepo
        .withTx(tx)
        .findByComposite(course.id, user.id);

      if (existing?.status === "active") {
        skipped += 1;
        continue;
      }

      if (existing?.status === "removed") {
        await courseMembershipRepo.withTx(tx).updateById(existing.id, {
          role: payload.role,
          status: "active",
          joinedAt: now,
          removedAt: null,
          addedByUserId: actor.userId,
        });
        reactivated += 1;
        added += 1;
        continue;
      }

      await courseMembershipRepo.withTx(tx).create({
        courseId: course.id,
        userId: user.id,
        role: payload.role,
        status: "active",
        joinedAt: now,
        addedByUserId: actor.userId,
      });
      added += 1;
    }

    return { added, placeholdersCreated, skipped, reactivated };
  });
}

export async function changeMemberRole(
  actor: ActorContext,
  courseId: string,
  userId: string,
  role: CourseRole,
) {
  return runTransaction(async (tx) => {
    await lockCourseMembers(tx, courseId);
    const actorRole = await resolveActorCourseRoleTx(tx, actor, courseId);
    if (actorRole !== "admin" && actorRole !== "teacher") {
      throw new ForbiddenError("Only teachers or admins can change member roles.");
    }
    if (actorRole === "teacher") {
      if (userId === actor.userId) {
        throw new ForbiddenError("You cannot change your own role.");
      }
      if (role === "teacher") {
        throw new ForbiddenError("Only an admin can promote a member to teacher.");
      }
      if ((await activeMemberRoleTx(tx, courseId, userId)) === "teacher") {
        throw new ForbiddenError("Teachers cannot change another teacher's role.");
      }
    }
    return courseMembershipAdminRepo.withTx(tx).updateRole(courseId, userId, role);
  });
}

export async function removeMember(actor: ActorContext, courseId: string, userId: string) {
  return runTransaction(async (tx) => {
    await lockCourseMembers(tx, courseId);
    const actorRole = await resolveActorCourseRoleTx(tx, actor, courseId);
    if (actorRole !== "admin" && actorRole !== "teacher") {
      throw new ForbiddenError("Only teachers or admins can remove members.");
    }
    if (actorRole === "teacher") {
      if (userId === actor.userId) {
        throw new ForbiddenError("You cannot remove yourself.");
      }
      if ((await activeMemberRoleTx(tx, courseId, userId)) === "teacher") {
        throw new ForbiddenError("Teachers cannot remove another teacher.");
      }
    }
    return courseMembershipAdminRepo.withTx(tx).removeFromCourse(courseId, userId);
  });
}

async function createPlaceholderInTx(tx: TransactionClient, username: string) {
  return userRepo.withTx(tx).create({
    email: `placeholder+${username}@placeholder.nojv.local`,
    username,
    displayUsername: username,
    name: username,
    emailVerified: false,
    status: "pending_first_login",
    disabled: false,
    platformRole: "student",
  });
}
