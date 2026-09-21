import { describe, expect, it, vi } from "vitest";

import type { ActorContext } from "@nojv/application";
import { feedbackDomain } from "@nojv/application";

import * as submissionStatusRoute from "../../../apps/web/src/routes/api/submissions/status/+server";
import * as submissionPendingRoute from "../../../apps/web/src/routes/api/submissions/pending/+server";
import * as submissionHistoryRoute from "../../../apps/web/src/routes/api/submissions/+server";
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
    examId: currentExam.id,
  });
  const hidden = await createTestSubmission({ userId: student.id, problemId: problem.id });
  await testPrisma.activeExamSession.create({
    data: { userId: student.id, examId: currentExam.id },
  });
  invalidateExamContextCaches(student.id);
  return { current, hidden, student, currentExam, course, problem };
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
    const membership = await testPrisma.courseMembership.create({
      data: { courseId: course.id, userId: student.id, role: "student", status: "active" },
    });
    await testPrisma.assessmentProblem.create({
      data: { assessmentId: assignment.id, problemId: problem.id, ordinal: 1, points: 100 },
    });
    await feedbackDomain.upsertFeedback(actorOf(teacher), {
      context: { type: "assignment", assignmentId: assignment.id },
      input: {
        courseMembershipId: membership.id,
        problemId: problem.id,
        comment: "Student feedback",
      },
    });
    const { load } =
      await import("../../../apps/web/src/routes/(app)/submissions/[submissionId]/+page.server");

    for (const staff of [teacher, ta]) {
      const page = (await load({
        depends: vi.fn(),
        locals: { sessionUser: staff, adminAccessActive: false },
        params: { submissionId: submission.id },
      } as never)) as {
        submission: Record<string, unknown> & { id: string; viewerIsStaff: boolean };
        feedback: string | null;
      };

      expect(page.submission).toMatchObject({ id: submission.id, viewerIsStaff: true });
      expect(page.feedback).toBe("Student feedback");
      expect(page.submission).not.toHaveProperty("feedbackStudentUserId");
      expect(JSON.stringify(page)).not.toContain(student.id);
      expect(JSON.stringify(page)).not.toContain(membership.id);
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
        depends: vi.fn(),
        locals: { sessionUser: outsider, adminAccessActive: false },
        params: { submissionId: submission.id },
      } as never),
    ).rejects.toMatchObject({ status: 404, body: { message: "Submission not found." } });
  }, 30_000);
});

describe("unified tracking at the real hooks/API boundary", () => {
  it("returns current-exam states while making private, cross-user and absent IDs indistinguishable", async () => {
    const { current, hidden, student, currentExam, problem } = await createActiveExamFixture();
    const other = await createTestUser();
    const privateRow = await createTestSubmission({
      userId: other.id,
      problemId: problem.id,
      examId: currentExam.id,
      status: "running",
    });
    await testPrisma.submission.update({
      where: { id: current.id },
      data: { status: "running" },
    });
    const requested = [current.id, hidden.id, privateRow.id, "missing"];
    const response = await callRoute({
      path: `/api/submissions/status?ids=${requested.join(",")}`,
      module: submissionStatusRoute,
      user: student,
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      items: {
        submissionId: string;
        result: unknown;
        status: string;
        judgeGeneration: number;
        updatedAt: string;
      }[];
      unavailableIds: string[];
    };
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({
      submissionId: current.id,
      status: "running",
      result: null,
    });
    expect(payload.items[0]?.judgeGeneration).toBeTypeOf("number");
    expect(Number.isFinite(Date.parse(payload.items[0]!.updatedAt))).toBe(true);
    expect(payload.unavailableIds).toEqual([hidden.id, privateRow.id, "missing"]);
    const pending = await callRoute({
      path: "/api/submissions/pending",
      module: submissionPendingRoute,
      user: student,
    });
    expect(pending.status).toBe(200);
    await expect(pending.json()).resolves.toMatchObject({
      items: [{ submissionId: current.id, status: "running", result: null }],
      nextCursor: null,
    });
  }, 30_000);

  it("serves every snapshot page beyond 150 tied rows and reports arrivals without shifting older pages", async () => {
    const student = await createTestUser();
    const problem = await createTestProblem();
    const createdAt = new Date(Date.now() - 60_000);
    const expected = Array.from(
      { length: 151 },
      (_, index) => `http_history_${String(index).padStart(3, "0")}`,
    ).reverse();
    for (const id of expected)
      await createTestSubmission({ id, userId: student.id, problemId: problem.id, createdAt });
    type Page = {
      items: { id: string }[];
      snapshot: string;
      page: number;
      totalCount: number;
      totalPages: number;
      newCount: number;
    };
    const read = async (page: number, snapshot?: string): Promise<Page> => {
      const query = new URLSearchParams({ page: String(page) });
      if (snapshot) query.set("snapshot", snapshot);
      const response = await callRoute({
        path: `/api/submissions?${query}`,
        module: submissionHistoryRoute,
        user: student,
      });
      expect(response.status).toBe(200);
      return (await response.json()) as Page;
    };
    const first = await read(1);
    expect(first).toMatchObject({ totalCount: 151, totalPages: 4, newCount: 0 });
    await createTestSubmission({
      id: "zz_http_arrival",
      userId: student.id,
      problemId: problem.id,
      createdAt,
    });
    const ids = first.items.map((row) => row.id);
    for (let page = 2; page <= 4; page += 1) {
      const result = await read(page, first.snapshot);
      expect(result).toMatchObject({
        page,
        snapshot: first.snapshot,
        totalCount: 151,
        newCount: 1,
      });
      ids.push(...result.items.map((row) => row.id));
    }
    expect(ids).toEqual(expected);
    const latest = await read(1);
    expect(latest).toMatchObject({ totalCount: 152, newCount: 0 });
    expect(latest.items[0]?.id).toBe("zz_http_arrival");
  }, 30_000);

  it("rejects a workspace cursor from another problem through the route", async () => {
    const { current, student, currentExam } = await createActiveExamFixture();
    const problemB = await createTestProblem();
    const outside = await createTestSubmission({
      userId: student.id,
      problemId: problemB.id,
      examId: currentExam.id,
    });
    const query = new URLSearchParams({
      problemId: current.problemId,
      workspaceContext: JSON.stringify({ type: "exam", examId: currentExam.id }),
      cursor: outside.id,
    });
    const response = await callRoute({
      path: `/api/submissions?${query}`,
      module: submissionHistoryRoute,
      user: student,
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: "Invalid submission cursor.",
    });
  }, 30_000);

  it("enforces batch size and authentication before exposing any submission data", async () => {
    const { student } = await createActiveExamFixture();
    const excessive = Array.from({ length: 101 }, (_, index) => `submission_${index}`);
    const response = await callRoute({
      path: `/api/submissions/status?ids=${excessive.join(",")}`,
      module: submissionStatusRoute,
      user: student,
    });
    expect(response.status).toBe(400);
    const anonymous = await callRoute({
      path: "/api/submissions/pending",
      module: submissionPendingRoute,
    });
    expect(anonymous.status).toBe(401);
  }, 30_000);

  it("rechecks private reference access after staff membership is revoked", async () => {
    const owner = await createTestUser({ platformRole: "teacher" });
    const reader = await createTestUser({ platformRole: "student" });
    const course = await createTestCourse({ ownerId: owner.id });
    const membership = await testPrisma.courseMembership.create({
      data: { courseId: course.id, userId: reader.id, role: "ta", status: "active" },
    });
    const problem = await createTestProblem({ authorId: owner.id, visibility: "private" });
    await testPrisma.courseProblem.create({
      data: { courseId: course.id, problemId: problem.id },
    });
    const reference = await createTestSubmission({
      userId: reader.id,
      problemId: problem.id,
      isReferenceSolution: true,
      status: "queued",
    });
    const query = `/api/submissions/status?ids=${reference.id}`;
    const permitted = await callRoute({
      path: query,
      module: submissionStatusRoute,
      user: reader,
    });
    expect(permitted.status).toBe(200);
    await expect(permitted.json()).resolves.toMatchObject({
      items: [{ submissionId: reference.id, status: "queued", result: null }],
      unavailableIds: [],
    });
    await testPrisma.courseMembership.update({
      where: { id: membership.id },
      data: { status: "removed" },
    });
    const revoked = await callRoute({
      path: query,
      module: submissionStatusRoute,
      user: reader,
    });
    expect(revoked.status).toBe(200);
    await expect(revoked.json()).resolves.toEqual({
      items: [],
      unavailableIds: [reference.id],
    });
    const pending = await callRoute({
      path: "/api/submissions/pending",
      module: submissionPendingRoute,
      user: reader,
    });
    expect(pending.status).toBe(200);
    await expect(pending.json()).resolves.toEqual({ items: [], nextCursor: null });
  }, 30_000);
});
