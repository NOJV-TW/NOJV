import { describe, expect, it, vi } from "vitest";

import type { ActorContext } from "@nojv/application";
import { feedbackDomain } from "@nojv/application";

import * as submissionPointRoute from "../../../apps/web/src/routes/api/submissions/[id]/+server";
import * as submissionRejudgeRoute from "../../../apps/web/src/routes/api/submissions/[id]/rejudge/+server";
import * as submissionSourceRoute from "../../../apps/web/src/routes/api/submissions/[id]/source/+server";
import { invalidateExamContextCaches } from "$lib/server/exam-context-cache";
import {
  createTestCourse,
  createTestExam,
  createTestProblem,
  createTestSubmission,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";
import { callRoute } from "./_harness";

vi.mock("$lib/auth.server", () => ({
  getAuth: () => ({
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const userId = headers.get("x-test-user-id");
        if (!userId) return null;
        const { testPrisma: prisma } = await import("../../fixtures/factories");
        const user = await prisma.user.findUnique({ where: { id: userId } });
        return user
          ? {
              session: { id: `session-${userId}`, userId, createdAt: new Date() },
              user,
            }
          : null;
      },
    },
  }),
}));

vi.mock("$lib/server/env", () => ({
  getWebEnv: () => ({ NODE_ENV: "development" }),
}));

function actorOf(user: {
  id: string;
  email: string;
  username: string | null;
  name: string;
  platformRole: string;
}): ActorContext {
  return {
    userId: user.id,
    email: user.email,
    username: user.username ?? user.id,
    displayName: user.name,
    platformRole: user.platformRole as ActorContext["platformRole"],
  };
}

async function createActiveExamFixture() {
  const student = await createTestUser({ platformRole: "student" });
  const course = await createTestCourse();
  await testPrisma.courseMembership.create({
    data: { courseId: course.id, userId: student.id, role: "student", status: "active" },
  });
  const problem = await createTestProblem();
  const currentExam = await createTestExam({ courseId: course.id });
  const current = await createTestSubmission({
    userId: student.id,
    problemId: problem.id,
    courseId: course.id,
    examId: currentExam.id,
  });
  const hidden = await createTestSubmission({ userId: student.id, problemId: problem.id });
  await testPrisma.activeExamSession.create({
    data: { userId: student.id, examId: currentExam.id },
  });
  invalidateExamContextCaches(student.id);
  return { current, hidden, student };
}

async function callSubmissionPoint(user: { id: string }, submissionId: string, method = "GET") {
  return callRoute({
    path: `/api/submissions/${submissionId}`,
    method,
    module: submissionPointRoute,
    params: { id: submissionId },
    user,
  });
}

describe("submission confinement at the real hooks/API boundary", () => {
  it("allows the current-exam point and source while returning the same 404 for hidden history", async () => {
    const { current, hidden, student } = await createActiveExamFixture();

    const currentPoint = await callSubmissionPoint(student, current.id);
    expect(currentPoint.status).toBe(200);
    await expect(currentPoint.json()).resolves.toMatchObject({ submissionId: current.id });

    const currentSource = await callRoute({
      path: `/api/submissions/${current.id}/source`,
      module: submissionSourceRoute,
      params: { id: current.id },
      user: student,
    });
    expect(currentSource.status).toBe(200);

    for (const response of [
      await callSubmissionPoint(student, hidden.id),
      await callRoute({
        path: `/api/submissions/${hidden.id}/source`,
        module: submissionSourceRoute,
        params: { id: hidden.id },
        user: student,
      }),
    ]) {
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ message: "Submission not found." });
    }
  }, 30_000);

  it("fails closed in hooks before unsupported methods and unknown nested routes reach resolve", async () => {
    const { current, student } = await createActiveExamFixture();

    for (const response of [
      await callSubmissionPoint(student, current.id, "PATCH"),
      await callRoute({
        path: `/api/submissions/${current.id}/unreviewed`,
        module: {},
        params: { id: current.id },
        user: student,
      }),
      await callRoute({
        path: `/api/submissions/${current.id}/rejudge`,
        method: "POST",
        module: submissionRejudgeRoute,
        params: { id: current.id },
        user: student,
      }),
    ]) {
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ code: "exam_api_scope" });
    }
  }, 30_000);
});

describe("submission detail at the real SSR loader boundary", () => {
  it("allows non-admin course staff and resolves feedback for the submitter without leaking its internal id", async () => {
    const student = await createTestUser({
      name: "Feedback Student",
      platformRole: "student",
      username: "feedback-student",
    });
    const teacher = await createTestUser({ platformRole: "teacher" });
    const ta = await createTestUser({ platformRole: "student" });
    const course = await createTestCourse();
    await testPrisma.courseMembership.createMany({
      data: [
        { courseId: course.id, userId: teacher.id, role: "teacher", status: "active" },
        { courseId: course.id, userId: ta.id, role: "ta", status: "active" },
      ],
    });
    const problem = await createTestProblem({ authorId: teacher.id });
    const assignment = await testPrisma.assessment.create({
      data: {
        courseId: course.id,
        createdByUserId: teacher.id,
        title: "Closed staff detail assignment",
        summary: "closed",
        status: "published",
        opensAt: new Date(Date.now() - 7_200_000),
        closesAt: new Date(Date.now() - 3_600_000),
      },
    });
    const submission = await createTestSubmission({
      userId: student.id,
      problemId: problem.id,
      courseId: course.id,
      assessmentId: assignment.id,
    });
    await feedbackDomain.upsertFeedback(actorOf(teacher), {
      context: { type: "assignment", assignmentId: assignment.id },
      input: { studentUserId: student.id, problemId: problem.id, comment: "Student feedback" },
    });
    const { load } =
      await import("../../../apps/web/src/routes/(app)/submissions/[submissionId]/+page.server");

    for (const staff of [teacher, ta]) {
      const page = (await load({
        locals: { sessionUser: staff, adminModeActive: false },
        params: { submissionId: submission.id },
      } as never)) as {
        submission: Record<string, unknown> & { id: string; viewerIsStaff: boolean };
        feedback: string | null;
      };

      expect(page.submission).toMatchObject({ id: submission.id, viewerIsStaff: true });
      expect(page.feedback).toBe("Student feedback");
      expect(page.submission).not.toHaveProperty("feedbackStudentUserId");
      expect(JSON.stringify(page)).not.toContain(student.id);
    }
  }, 30_000);

  it("keeps the SSR denial generic for a non-staff non-owner", async () => {
    const owner = await createTestUser();
    const outsider = await createTestUser();
    const problem = await createTestProblem();
    const submission = await createTestSubmission({ userId: owner.id, problemId: problem.id });
    const { load } =
      await import("../../../apps/web/src/routes/(app)/submissions/[submissionId]/+page.server");

    await expect(
      load({
        locals: { sessionUser: outsider, adminModeActive: false },
        params: { submissionId: submission.id },
      } as never),
    ).rejects.toMatchObject({ status: 404, body: { message: "Submission not found." } });
  }, 30_000);
});
