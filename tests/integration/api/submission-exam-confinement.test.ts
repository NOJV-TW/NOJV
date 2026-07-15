import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotFoundError, submissionDomain, ValidationError } from "@nojv/application";
import type { ActorContext } from "@nojv/application";
import { getSubmissionSources as storageGetSubmissionSources } from "@nojv/storage";

import {
  createTestContest,
  createTestCourse,
  createTestExam,
  createTestProblem,
  createTestSubmission,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

const {
  getSubmissionDetail,
  getSubmissionForActor,
  getSubmissionSources,
  listUserSubmissions,
} = submissionDomain;

function actorOf(user: {
  id: string;
  email: string;
  username: string;
  name: string;
  platformRole: string;
}): ActorContext {
  return {
    userId: user.id,
    email: user.email,
    username: user.username,
    displayName: user.name,
    platformRole: user.platformRole as ActorContext["platformRole"],
  };
}

async function expectGenericNotFound(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({
    name: NotFoundError.name,
    message: "Submission not found.",
    status: 404,
  });
}

async function createFixture() {
  const owner = await createTestUser();
  const other = await createTestUser();
  const admin = await createTestUser({ platformRole: "admin" });
  const course = await createTestCourse();
  const problem = await createTestProblem({ authorId: owner.id });
  const examA = await createTestExam({ courseId: course.id });
  const examB = await createTestExam({ courseId: course.id });
  const contest = await createTestContest();
  const assignment = await testPrisma.assessment.create({
    data: {
      courseId: course.id,
      createdByUserId: course.ownerId,
      title: "Confinement assignment",
      summary: "must be hidden during an exam",
      status: "published",
      opensAt: new Date("2026-01-01T00:00:00Z"),
      closesAt: new Date("2026-12-31T23:59:59Z"),
    },
  });

  const rows = {
    practice: await createTestSubmission({ userId: owner.id, problemId: problem.id }),
    assignment: await createTestSubmission({
      userId: owner.id,
      problemId: problem.id,
      courseId: course.id,
      assessmentId: assignment.id,
    }),
    contest: await createTestSubmission({
      userId: owner.id,
      problemId: problem.id,
      contestId: contest.id,
    }),
    otherExam: await createTestSubmission({
      userId: owner.id,
      problemId: problem.id,
      examId: examB.id,
    }),
    currentExam: await createTestSubmission({
      userId: owner.id,
      problemId: problem.id,
      examId: examA.id,
    }),
    otherUser: await createTestSubmission({
      userId: other.id,
      problemId: problem.id,
      examId: examA.id,
    }),
  };

  const session = await testPrisma.activeExamSession.create({
    data: { userId: owner.id, examId: examA.id },
  });

  return { admin, course, examA, examB, owner, other, problem, rows, session };
}

describe("submission reads during an active exam", () => {
  beforeEach(() => {
    vi.mocked(storageGetSubmissionSources).mockClear();
  });

  it("returns identical 404s for the owner's practice, assignment, contest, and other-exam points", async () => {
    const { owner, rows } = await createFixture();
    const actor = actorOf(owner);

    for (const submission of [rows.practice, rows.assignment, rows.contest, rows.otherExam]) {
      await expectGenericNotFound(getSubmissionForActor(actor, submission.id));
      await expectGenericNotFound(getSubmissionDetail(actor, submission.id));
    }
    expect(storageGetSubmissionSources).not.toHaveBeenCalled();
  });

  it("returns the same 404 for another user's current-exam submission", async () => {
    const { owner, rows } = await createFixture();

    await expectGenericNotFound(getSubmissionForActor(actorOf(owner), rows.otherUser.id));
    await expectGenericNotFound(getSubmissionDetail(actorOf(owner), rows.otherUser.id));
  });

  it("allows the owner's current-exam point and detail", async () => {
    const { owner, rows } = await createFixture();

    await expect(
      getSubmissionForActor(actorOf(owner), rows.currentExam.id),
    ).resolves.toMatchObject({ id: rows.currentExam.id });
    await expect(
      getSubmissionDetail(actorOf(owner), rows.currentExam.id),
    ).resolves.toMatchObject({
      id: rows.currentExam.id,
      context: { kind: "exam" },
    });
  });

  it("does not touch source storage for a denied point", async () => {
    const { owner, rows } = await createFixture();

    await expectGenericNotFound(
      (async () => {
        const submission = await getSubmissionForActor(actorOf(owner), rows.practice.id);
        return getSubmissionSources(submission.id);
      })(),
    );
    expect(storageGetSubmissionSources).not.toHaveBeenCalled();
  });

  it("preserves inactive owner history and effective-admin point recovery", async () => {
    const { admin, owner, rows, session } = await createFixture();

    await expect(
      getSubmissionForActor(actorOf(admin), rows.practice.id),
    ).resolves.toMatchObject({
      id: rows.practice.id,
    });
    await expect(getSubmissionDetail(actorOf(admin), rows.practice.id)).resolves.toMatchObject({
      id: rows.practice.id,
    });

    await testPrisma.activeExamSession.update({
      where: { id: session.id },
      data: { endedAt: new Date(), releaseReason: "submitted" },
    });
    await expect(
      getSubmissionForActor(actorOf(owner), rows.practice.id),
    ).resolves.toMatchObject({
      id: rows.practice.id,
    });
  });

  it("keeps an effective admin's list scoped to their own submissions", async () => {
    const { admin, problem, rows } = await createFixture();
    const own = await createTestSubmission({ userId: admin.id, problemId: problem.id });

    const page = await listUserSubmissions({ actor: actorOf(admin), limit: 50 });

    expect(page.items.map((item) => item.id)).toEqual([own.id]);
    expect(page.items.map((item) => item.id)).not.toContain(rows.practice.id);
  });

  it("SQL-scopes both pages to the active exam across a 52-row result set", async () => {
    const { course, examA, owner, problem, rows } = await createFixture();
    await testPrisma.submission.delete({ where: { id: rows.currentExam.id } });
    const ids: string[] = [];
    for (let index = 0; index < 52; index += 1) {
      const row = await createTestSubmission({
        id: `exam_page_${String(index).padStart(2, "0")}`,
        userId: owner.id,
        problemId: problem.id,
        examId: examA.id,
        createdAt: new Date(Date.UTC(2026, 6, 1, 0, 0, index)),
      });
      ids.push(row.id);
    }

    const first = await listUserSubmissions({
      actor: actorOf(owner),
      limit: 50,
    });
    expect(first.items).toHaveLength(50);
    expect(first.items.map((item) => item.id)).toEqual(ids.slice(2).reverse());
    expect(first.nextCursor).toBe(ids[2]);

    const second = await listUserSubmissions({
      actor: actorOf(owner),
      limit: 50,
      cursor: first.nextCursor!,
    });
    expect(second.items.map((item) => item.id)).toEqual(ids.slice(0, 2).reverse());
    expect(second.nextCursor).toBeNull();
  });

  it("rejects nonexistent and out-of-scope cursors with one generic 400", async () => {
    const { owner, rows } = await createFixture();

    for (const cursor of [
      "submission_does_not_exist",
      rows.practice.id,
      rows.otherExam.id,
      rows.otherUser.id,
    ]) {
      await expect(
        listUserSubmissions({ actor: actorOf(owner), limit: 50, cursor }),
      ).rejects.toMatchObject({
        name: ValidationError.name,
        message: "Invalid submission cursor.",
        status: 400,
      });
    }
  });
});
