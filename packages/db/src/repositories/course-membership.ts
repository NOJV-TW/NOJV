import { prisma } from "../client";
import type { CourseRole } from "../../generated/prisma/enums";

/**
 * Teacher-facing roster repository. Complements `courseMembershipRepo`
 * in `course.ts` (which covers card counts and student lookups) with
 * the mutations needed by the members tab UI: list the full roster
 * with the related user row, update a single member's role, and
 * soft-remove a member.
 *
 * Soft-delete: `removeFromCourse` flips status to `removed` and stamps
 * `removedAt`. Placeholder attachment relies on the row still existing
 * so a re-added student keeps their audit trail.
 */
export const courseMembershipAdminRepo = {
  /**
   * Full roster for a course. Returns every membership row (active and
   * removed) joined with enough `User` fields to render the prototype
   * row: name/username for placeholder detection, email for the
   * teacher-only column, platform status to flag placeholders.
   */
  listWithUserByCourse(courseId: string) {
    return prisma.courseMembership.findMany({
      where: { courseId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
            status: true
          }
        }
      },
      orderBy: [{ role: "asc" }, { joinedAt: "asc" }]
    });
  },

  /**
   * Soft-remove a member from a course. Used by the teacher roster UI
   * X button. Returns the updated row so the caller can confirm the
   * change.
   */
  removeFromCourse(courseId: string, userId: string) {
    return prisma.courseMembership.update({
      where: { courseId_userId: { courseId, userId } },
      data: {
        status: "removed",
        removedAt: new Date()
      }
    });
  },

  /**
   * Update a member's role (student ↔ ta). Teachers can demote other
   * teachers too, but the caller is expected to block removing the
   * last teacher — this repo does not.
   */
  updateRole(courseId: string, userId: string, role: CourseRole) {
    return prisma.courseMembership.update({
      where: { courseId_userId: { courseId, userId } },
      data: { role }
    });
  }
};
