import { describe, expect, it } from "vitest";
import type { RequestEvent } from "@sveltejs/kit";
import { courseMembershipAdminRepo, courseRepo } from "@nojv/db";

import { getCoursePermissionRole, requireAuth } from "$lib/server/auth";
import { load as loadCourseLayout } from "../../../apps/web/src/routes/(app)/courses/[courseId]/+layout.server";
import { load as loadAssignmentLayout } from "../../../apps/web/src/routes/(app)/assignments/[assignmentId]/+layout.server";
import { load as loadExamLayout } from "../../../apps/web/src/routes/(app)/exams/[examId]/+layout.server";
import { load as loadGrades } from "../../../apps/web/src/routes/(app)/courses/[courseId]/grades/+page.server";
import { load as loadAnalytics } from "../../../apps/web/src/routes/(app)/courses/[courseId]/analytics/+page.server";
import {
  createTestCourse,
  createTestExam,
  createTestProblem,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;
type CourseLayoutEvent = Parameters<typeof loadCourseLayout>[0];

function eventFor(user: TestUser, path: string, params: Record<string, string>) {
  const url = new URL(path, "http://localhost");
  return {
    url,
    request: new Request(url),
    params,
    getClientAddress: () => "127.0.0.1",
    locals: {
      sessionUser: user,
      adminAccessActive: false,
      apiTokenActor: null,
      examGate: null,
    },
  } as unknown as RequestEvent;
}

function courseEvent(user: TestUser, courseId: string) {
  return eventFor(user, `/courses/${courseId}`, { courseId }) as CourseLayoutEvent;
}

function gradesFor(user: TestUser, courseId: string) {
  return loadGrades({
    ...eventFor(user, `/courses/${courseId}/grades`, { courseId }),
    parent: () => loadCourseLayout(courseEvent(user, courseId)),
  } as Parameters<typeof loadGrades>[0]);
}

function analyticsFor(user: TestUser, courseId: string) {
  return loadAnalytics({
    ...eventFor(user, `/courses/${courseId}/analytics`, { courseId }),
    parent: () => loadCourseLayout(courseEvent(user, courseId)),
  } as Parameters<typeof loadAnalytics>[0]);
}

async function fixture(role: "ta" | "teacher") {
  const owner = await createTestUser({ platformRole: "teacher" });
  const staff = await createTestUser({
    platformRole: role === "teacher" ? "teacher" : "student",
  });
  const student = await createTestUser();
  const course = await createTestCourse({ ownerId: owner.id });
  const staffMembership = await testPrisma.courseMembership.create({
    data: { courseId: course.id, userId: staff.id, role, status: "active" },
  });
  const studentMembership = await testPrisma.courseMembership.create({
    data: { courseId: course.id, userId: student.id, role: "student" },
  });
  const pendingMembership = await testPrisma.courseMembership.create({
    data: { courseId: course.id, pendingUsername: "pending.student", role: "student" },
  });
  const problem = await createTestProblem({ authorId: owner.id });
  const assignment = await testPrisma.assessment.create({
    data: {
      courseId: course.id,
      createdByUserId: owner.id,
      title: "Closed assignment",
      summary: "",
      status: "published",
      opensAt: new Date("2020-01-01"),
      closesAt: new Date("2020-01-02"),
      problems: { create: { problemId: problem.id, ordinal: 1, points: 100 } },
    },
  });
  const exam = await createTestExam({
    courseId: course.id,
    createdByUserId: owner.id,
    startsAt: new Date("2020-01-01"),
    endsAt: new Date("2020-01-02"),
  });
  await testPrisma.scoreOverride.createMany({
    data: [studentMembership, pendingMembership].map((membership, index) => ({
      courseMembershipId: membership.id,
      userId: null,
      problemId: problem.id,
      contextType: "assignment",
      contextId: assignment.id,
      overrideScore: index === 0 ? 80 : 60,
      reason: "Manual grade",
      createdByUserId: owner.id,
      updatedByUserId: owner.id,
    })),
  });
  return { course, assignment, exam, staff, staffMembership, student, studentMembership };
}

describe("removed course staff access (real DB)", () => {
  it.each(["ta", "teacher"] as const)(
    "revokes %s access to layouts, grades, analytics and permission roles without erasing history",
    async (role) => {
      const { course, assignment, exam, staff, staffMembership } = await fixture(role);
      const event = courseEvent(staff, course.id);
      const actor = requireAuth(event);
      const assignmentEvent = eventFor(staff, `/assignments/${assignment.id}`, {
        assignmentId: assignment.id,
      }) as Parameters<typeof loadAssignmentLayout>[0];
      const examEvent = eventFor(staff, `/exams/${exam.id}`, {
        examId: exam.id,
      }) as Parameters<typeof loadExamLayout>[0];

      for (const findCourse of [
        courseRepo.findByIdWithUserMembership,
        courseRepo.findByIdWithHeader,
      ]) {
        await expect(findCourse(course.id, staff.id)).resolves.toMatchObject({
          memberships: [{ id: staffMembership.id, role, status: "active" }],
        });
      }
      await expect(getCoursePermissionRole(course.id, actor)).resolves.toBe(role);
      await expect(loadCourseLayout(event)).resolves.toMatchObject({ isManager: true });
      await expect(loadAssignmentLayout(assignmentEvent)).resolves.toMatchObject({
        isManager: true,
      });
      await expect(loadExamLayout(examEvent)).resolves.toMatchObject({ isManager: true });
      const grades = await gradesFor(staff, course.id);
      expect(grades?.gradebook.rows).toHaveLength(2);
      expect(grades?.gradebook.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ total: 80 }),
          expect.objectContaining({ userId: null, total: 60 }),
        ]),
      );
      await expect(analyticsFor(staff, course.id)).resolves.toMatchObject({
        analytics: { studentCount: 2, assessmentCount: 1 },
      });

      await courseMembershipAdminRepo.removeFromCourse(course.id, staffMembership.id);

      await expect(
        testPrisma.courseMembership.findUniqueOrThrow({ where: { id: staffMembership.id } }),
      ).resolves.toMatchObject({
        userId: staff.id,
        role,
        status: "removed",
        removedAt: expect.any(Date),
      });
      for (const findCourse of [
        courseRepo.findByIdWithUserMembership,
        courseRepo.findByIdWithHeader,
      ]) {
        await expect(findCourse(course.id, staff.id)).resolves.toMatchObject({
          memberships: [],
        });
      }
      await expect(getCoursePermissionRole(course.id, actor)).resolves.toBeNull();
      await expect(loadCourseLayout(event)).rejects.toMatchObject({ status: 403 });
      await expect(gradesFor(staff, course.id)).rejects.toMatchObject({ status: 403 });
      await expect(analyticsFor(staff, course.id)).rejects.toMatchObject({ status: 403 });
      await expect(loadAssignmentLayout(assignmentEvent)).rejects.toMatchObject({
        status: 404,
      });
      await expect(loadExamLayout(examEvent)).rejects.toMatchObject({ status: 404 });
    },
  );

  it("keeps active students limited to their own grades and denies class analytics", async () => {
    const { course, student, studentMembership } = await fixture("ta");
    const event = courseEvent(student, course.id);
    await expect(loadCourseLayout(event)).resolves.toMatchObject({ isManager: false });
    await expect(getCoursePermissionRole(course.id, requireAuth(event))).resolves.toBe(
      "student",
    );
    const grades = await gradesFor(student, course.id);
    expect(grades?.gradebook.rows).toHaveLength(1);
    expect(grades?.gradebook.rows[0]).toMatchObject({
      membershipId: studentMembership.id,
      userId: student.id,
      total: 80,
    });
    await expect(analyticsFor(student, course.id)).rejects.toMatchObject({ status: 403 });
  });
});
