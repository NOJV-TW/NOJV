import { describe, expect, it } from "vitest";

import type { Prisma } from "../../../packages/db/generated/prisma/client";
import { createTestCourse, createTestUser, testPrisma } from "../../fixtures/factories";

function assessmentInput(overrides: {
  courseId: string;
  createdByUserId: string;
  slug: string;
}): Prisma.CourseAssessmentUncheckedCreateInput {
  return {
    courseId: overrides.courseId,
    createdByUserId: overrides.createdByUserId,
    slug: overrides.slug,
    title: `FK cascade ${overrides.slug}`,
    summary: "regression guard",
    opensAt: new Date("2026-01-01T00:00:00Z"),
    dueAt: new Date("2026-01-08T00:00:00Z"),
    closesAt: new Date("2026-01-09T00:00:00Z")
  };
}

/**
 * Regression guard for the round 4 finding: migration
 * `20260320000000_ip_lock_redesign` created `AssessmentParticipation_userId_fkey`
 * with `ON DELETE RESTRICT`, but `schema.prisma:605` declares `onDelete: Cascade`.
 *
 * Prisma's `db:push` (run in global-setup) syncs the test DB directly from
 * `schema.prisma`, so here we verify the schema's intent: deleting a User
 * should cascade through every related row that is declared `Cascade`,
 * including `AssessmentParticipation`.
 */
describe("schema FK cascade (real DB)", () => {
  it("deletes AssessmentParticipation rows when the User is deleted", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const student = await createTestUser({ platformRole: "student" });
    const course = await createTestCourse({ ownerId: teacher.id });

    const assessment = await testPrisma.courseAssessment.create({
      data: assessmentInput({
        courseId: course.id,
        createdByUserId: teacher.id,
        slug: "fk-cascade-user"
      })
    });

    const participation = await testPrisma.assessmentParticipation.create({
      data: { userId: student.id, assessmentId: assessment.id }
    });

    // Deleting the User must not throw and must cascade to its participations.
    await testPrisma.user.delete({ where: { id: student.id } });

    const remaining = await testPrisma.assessmentParticipation.findUnique({
      where: { id: participation.id }
    });
    expect(remaining).toBeNull();
  });

  it("deletes AssessmentParticipation rows when the CourseAssessment is deleted", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const student = await createTestUser({ platformRole: "student" });
    const course = await createTestCourse({ ownerId: teacher.id });

    const assessment = await testPrisma.courseAssessment.create({
      data: assessmentInput({
        courseId: course.id,
        createdByUserId: teacher.id,
        slug: "fk-cascade-assessment"
      })
    });

    const participation = await testPrisma.assessmentParticipation.create({
      data: { userId: student.id, assessmentId: assessment.id }
    });

    await testPrisma.courseAssessment.delete({ where: { id: assessment.id } });

    const remaining = await testPrisma.assessmentParticipation.findUnique({
      where: { id: participation.id }
    });
    expect(remaining).toBeNull();
  });
});
