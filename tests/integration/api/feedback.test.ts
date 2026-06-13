import { describe, expect, it } from "vitest";

import { feedbackDomain } from "@nojv/application";

import {
  createTestCourse,
  createTestProblem,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

import type { ActorContext } from "../../../packages/application/src/shared/actor-context";

function actorOf(user: {
  id: string;
  email: string;
  username: string;
  name: string;
}): ActorContext {
  return {
    userId: user.id,
    email: user.email,
    username: user.username,
    displayName: user.name,
    platformRole: "teacher",
  };
}

async function makeCourseTeacher(courseId: string) {
  const teacher = await createTestUser({ platformRole: "teacher" });
  await testPrisma.courseMembership.create({
    data: { courseId, userId: teacher.id, role: "teacher", status: "active" },
  });
  return teacher;
}

describe("feedback API domain layer (real DB)", () => {
  describe("assignment context", () => {
    it("rejects an upsert while the assignment is still open (409 → ConflictError)", async () => {
      const course = await createTestCourse();
      const teacher = await makeCourseTeacher(course.id);
      const student = await createTestUser({ platformRole: "student" });
      const problem = await createTestProblem({ authorId: teacher.id });

      const assignment = await testPrisma.assessment.create({
        data: {
          courseId: course.id,
          createdByUserId: teacher.id,
          title: "Open HW",
          summary: "still open",
          status: "published",
          opensAt: new Date(Date.now() - 3600_000),
          closesAt: new Date(Date.now() + 3600_000),
        },
      });

      await expect(
        feedbackDomain.upsertFeedback(actorOf(teacher), {
          context: { type: "assignment", assignmentId: assignment.id },
          input: { studentUserId: student.id, problemId: problem.id, comment: "Nice work" },
        }),
      ).rejects.toThrow(/still open/i);
    });

    it("accepts an upsert once the assignment has closed, and GET surfaces the row", async () => {
      const course = await createTestCourse();
      const teacher = await makeCourseTeacher(course.id);
      const student = await createTestUser({ platformRole: "student" });
      const problem = await createTestProblem({ authorId: teacher.id });

      const assignment = await testPrisma.assessment.create({
        data: {
          courseId: course.id,
          createdByUserId: teacher.id,
          title: "Closed HW",
          summary: "graded",
          status: "published",
          opensAt: new Date(Date.now() - 7200_000),
          closesAt: new Date(Date.now() - 3600_000),
        },
      });

      const context = { type: "assignment" as const, assignmentId: assignment.id };

      const row = await feedbackDomain.upsertFeedback(actorOf(teacher), {
        context,
        input: { studentUserId: student.id, problemId: problem.id, comment: "Well done" },
      });
      expect(row.comment).toBe("Well done");
      expect(row.studentUserId).toBe(student.id);

      const items = await feedbackDomain.listFeedbackForContext(context);
      expect(items).toHaveLength(1);
      expect(items[0]!.id).toBe(row.id);
      expect(items[0]!.comment).toBe("Well done");
    });

    it("upsert is idempotent on the (student, problem, context) triple — second call edits", async () => {
      const course = await createTestCourse();
      const teacher = await makeCourseTeacher(course.id);
      const student = await createTestUser({ platformRole: "student" });
      const problem = await createTestProblem({ authorId: teacher.id });

      const assignment = await testPrisma.assessment.create({
        data: {
          courseId: course.id,
          createdByUserId: teacher.id,
          title: "Closed HW 2",
          summary: "graded",
          status: "published",
          opensAt: new Date(Date.now() - 7200_000),
          closesAt: new Date(Date.now() - 3600_000),
        },
      });
      const context = { type: "assignment" as const, assignmentId: assignment.id };

      const first = await feedbackDomain.upsertFeedback(actorOf(teacher), {
        context,
        input: { studentUserId: student.id, problemId: problem.id, comment: "First pass" },
      });
      const second = await feedbackDomain.upsertFeedback(actorOf(teacher), {
        context,
        input: { studentUserId: student.id, problemId: problem.id, comment: "Revised" },
      });

      expect(second.id).toBe(first.id);
      const items = await feedbackDomain.listFeedbackForContext(context);
      expect(items).toHaveLength(1);
      expect(items[0]!.comment).toBe("Revised");
    });
  });

  describe("exam context", () => {
    it("rejects an upsert while the exam is still open (409 → ConflictError)", async () => {
      const course = await createTestCourse();
      const teacher = await makeCourseTeacher(course.id);
      const student = await createTestUser({ platformRole: "student" });
      const problem = await createTestProblem({ authorId: teacher.id });

      const exam = await testPrisma.exam.create({
        data: {
          courseId: course.id,
          title: "Open Exam",
          summary: "still open",
          status: "published",
          startsAt: new Date(Date.now() - 3600_000),
          endsAt: new Date(Date.now() + 3600_000),
        },
      });

      await expect(
        feedbackDomain.upsertFeedback(actorOf(teacher), {
          context: { type: "exam", examId: exam.id },
          input: { studentUserId: student.id, problemId: problem.id, comment: "See me" },
        }),
      ).rejects.toThrow(/still open/i);
    });

    it("accepts an upsert once the exam has ended, and GET surfaces the row", async () => {
      const course = await createTestCourse();
      const teacher = await makeCourseTeacher(course.id);
      const student = await createTestUser({ platformRole: "student" });
      const problem = await createTestProblem({ authorId: teacher.id });

      const exam = await testPrisma.exam.create({
        data: {
          courseId: course.id,
          title: "Ended Exam",
          summary: "graded",
          status: "published",
          startsAt: new Date(Date.now() - 7200_000),
          endsAt: new Date(Date.now() - 3600_000),
        },
      });
      const context = { type: "exam" as const, examId: exam.id };

      const row = await feedbackDomain.upsertFeedback(actorOf(teacher), {
        context,
        input: { studentUserId: student.id, problemId: problem.id, comment: "Good exam" },
      });

      const items = await feedbackDomain.listFeedbackForContext(context);
      expect(items).toHaveLength(1);
      expect(items[0]!.id).toBe(row.id);
      expect(items[0]!.comment).toBe("Good exam");
    });
  });

  describe("permissions", () => {
    it("rejects a non-staff actor with ForbiddenError (403)", async () => {
      const course = await createTestCourse();
      const teacher = await makeCourseTeacher(course.id);
      const student = await createTestUser({ platformRole: "student" });
      const problem = await createTestProblem({ authorId: teacher.id });

      const assignment = await testPrisma.assessment.create({
        data: {
          courseId: course.id,
          createdByUserId: teacher.id,
          title: "Closed HW 3",
          summary: "graded",
          status: "published",
          opensAt: new Date(Date.now() - 7200_000),
          closesAt: new Date(Date.now() - 3600_000),
        },
      });

      await expect(
        feedbackDomain.upsertFeedback(
          {
            userId: student.id,
            email: student.email,
            username: student.username,
            displayName: student.name,
            platformRole: "student",
          },
          {
            context: { type: "assignment", assignmentId: assignment.id },
            input: { studentUserId: student.id, problemId: problem.id, comment: "x" },
          },
        ),
      ).rejects.toThrow(/not permitted/i);
    });

    it("authorizes a staff GET on an OPEN context — assertCanViewFeedback does not gate on close", async () => {
      const course = await createTestCourse();
      const teacher = await makeCourseTeacher(course.id);

      const assignment = await testPrisma.assessment.create({
        data: {
          courseId: course.id,
          createdByUserId: teacher.id,
          title: "Open HW (read auth)",
          summary: "still open",
          status: "published",
          opensAt: new Date(Date.now() - 3600_000),
          closesAt: new Date(Date.now() + 3600_000),
        },
      });
      const context = { type: "assignment" as const, assignmentId: assignment.id };

      await expect(
        feedbackDomain.assertCanViewFeedback(actorOf(teacher), context),
      ).resolves.toBeUndefined();

      await expect(
        feedbackDomain.assertCanWriteFeedback(actorOf(teacher), context),
      ).rejects.toThrow(/still open/i);
    });
  });
});
