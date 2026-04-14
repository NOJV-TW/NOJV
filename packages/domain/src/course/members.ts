import { courseMembershipAdminRepo, runTransaction, type TransactionClient } from "@nojv/db";
import type { CourseRole } from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import { requireCourse } from "../shared/require";

/**
 * Roster row returned by `listMembersForCourse`. Holds just enough to
 * render the prototype 12 member list: avatar-seed fields, a
 * placeholder flag so the UI can de-emphasize `pending_first_login`
 * users, role + joined metadata for the right-hand column. Email is
 * always present here — the route strips it for non-manager viewers.
 */
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

/**
 * Fetch the full roster for the members tab. Includes removed rows so
 * the UI can offer a "show removed" toggle later — the current UI
 * filters them out in the page template.
 */
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
    removedAt: row.removedAt?.toISOString() ?? null
  }));
}

/**
 * Normalize a raw textarea string into a deduped array of lowercase
 * handles. Accepts newlines, commas, semicolons, and whitespace as
 * separators. Empty strings are dropped. Order follows first-occurrence
 * so the server-side summary matches the visual order of the pasted
 * list.
 */
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

/**
 * Result summary for `bulkAddByHandle`. Used by the route action to
 * build the toast message.
 *
 * - `added`: new membership rows created (either by attaching an
 *   existing user or a freshly-created placeholder).
 * - `placeholdersCreated`: subset of `added` where a new `User` row
 *   with `status: pending_first_login` had to be created.
 * - `skipped`: handles that already had an active membership in this
 *   course; left untouched.
 * - `reactivated`: handles that had a `removed` membership; flipped
 *   back to `active` with a fresh `joinedAt`.
 */
export interface BulkAddResult {
  added: number;
  placeholdersCreated: number;
  skipped: number;
  reactivated: number;
}

/**
 * Bulk-add members to a course by handle. One transaction per call so
 * a partial failure rolls back cleanly. Unknown handles get a
 * placeholder `User` row (spec §5.3); existing users get a
 * `CourseMembership` upsert. Handles with an already-active membership
 * are skipped so replaying the same paste is idempotent.
 */
export async function bulkAddByHandle(
  actor: ActorContext,
  courseId: string,
  payload: { handles: string[]; role: CourseRole }
): Promise<BulkAddResult> {
  const uniqueHandles = Array.from(
    new Set(payload.handles.map((h) => h.trim().toLowerCase()))
  ).filter((h) => h.length > 0);

  return runTransaction(async (tx) => {
    const course = await requireCourse(tx, courseId);
    const now = new Date();
    let added = 0;
    let placeholdersCreated = 0;
    let skipped = 0;
    let reactivated = 0;

    for (const handle of uniqueHandles) {
      // findByUsername lives on the non-tx repo. Placeholder creation
      // is rare enough to eat a round-trip per handle; we avoid
      // pre-batching so the tx rollback semantics stay simple.
      let user = await tx.user.findUnique({ where: { username: handle } });

      if (!user) {
        // Reuse the non-tx placeholder helper via the tx client to keep
        // the create inside the same transaction — calling
        // `userRepo.createPlaceholder` would break the atomicity
        // guarantee.
        user = await createPlaceholderInTx(tx, handle);
        placeholdersCreated += 1;
      }

      const existing = await tx.courseMembership.findUnique({
        where: { courseId_userId: { courseId: course.id, userId: user.id } }
      });

      if (existing?.status === "active") {
        skipped += 1;
        continue;
      }

      if (existing?.status === "removed") {
        await tx.courseMembership.update({
          where: { id: existing.id },
          data: {
            role: payload.role,
            status: "active",
            joinedAt: now,
            removedAt: null,
            addedByUserId: actor.userId
          }
        });
        reactivated += 1;
        added += 1;
        continue;
      }

      await tx.courseMembership.create({
        data: {
          courseId: course.id,
          userId: user.id,
          role: payload.role,
          status: "active",
          joinedAt: now,
          addedByUserId: actor.userId
        }
      });
      added += 1;
    }

    return { added, placeholdersCreated, skipped, reactivated };
  });
}

/**
 * Flip a member's role. Wraps `courseMembershipAdminRepo.updateRole`
 * and surfaces the course-existence check so the route doesn't have to
 * do it separately.
 */
export async function changeMemberRole(
  _actor: ActorContext,
  courseId: string,
  userId: string,
  role: CourseRole
) {
  return courseMembershipAdminRepo.updateRole(courseId, userId, role);
}

/**
 * Soft-remove a member from a course.
 */
export async function removeMember(_actor: ActorContext, courseId: string, userId: string) {
  return courseMembershipAdminRepo.removeFromCourse(courseId, userId);
}

/**
 * Internal: create a placeholder user inside an existing transaction.
 * Mirrors `userRepo.createPlaceholder` but operates on the tx client
 * so placeholder creation stays atomic with the matching membership
 * insert.
 */
async function createPlaceholderInTx(tx: TransactionClient, username: string) {
  return tx.user.create({
    data: {
      email: `placeholder+${username}@placeholder.nojv.local`,
      username,
      displayUsername: username,
      name: username,
      emailVerified: false,
      status: "pending_first_login",
      disabled: false,
      platformRole: "student"
    }
  });
}
