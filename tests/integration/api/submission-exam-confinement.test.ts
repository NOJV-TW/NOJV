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
  username: string | null;
  name: string;
  platformRole: string;
}): ActorContext {
  if (!user.username) throw new Error("Test user must have a username");
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

  it("keeps a private practice reference hidden from its owner and course staff during an exam", async () => {
    const { owner, other, admin, course, examA, problem, session } = await createFixture();
    await testPrisma.courseMembership.create({
      data: { courseId: course.id, userId: other.id, role: "ta" },
    });
    await testPrisma.courseProblem.create({
      data: { courseId: course.id, problemId: problem.id },
    });
    const reference = await createTestSubmission({
      userId: owner.id,
      problemId: problem.id,
      isReferenceSolution: true,
    });
    await testPrisma.activeExamSession.create({ data: { userId: other.id, examId: examA.id } });
    for (const reader of [owner, other]) {
      await expectGenericNotFound(getSubmissionForActor(actorOf(reader), reference.id));
      await expectGenericNotFound(getSubmissionDetail(actorOf(reader), reference.id));
      await expect(
        submissionDomain.listSubmissionOperations(actorOf(reader), [reference.id]),
      ).resolves.toEqual({ items: [], unavailableIds: [reference.id] });
    }
    expect(storageGetSubmissionSources).not.toHaveBeenCalled();
    await expect(getSubmissionForActor(actorOf(admin), reference.id)).resolves.toMatchObject({
      id: reference.id,
    });
    await testPrisma.activeExamSession.update({
      where: { id: session.id },
      data: { endedAt: new Date() },
    });
    await expect(getSubmissionForActor(actorOf(owner), reference.id)).resolves.toMatchObject({
      id: reference.id,
    });
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

  it("allows an effective admin to list all submissions", async () => {
    const { admin, problem, rows } = await createFixture();
    const own = await createTestSubmission({ userId: admin.id, problemId: problem.id });

    const page = await listUserSubmissions({ actor: actorOf(admin), limit: 50 });
    const ids = page.items.map((item) => item.id);

    expect(new Set(ids)).toEqual(
      new Set([own.id, ...Object.values(rows).map((submission) => submission.id)]),
    );
  });

  it("SQL-scopes both pages to the active exam across a 52-row result set", async () => {
    const { examA, owner, problem, rows } = await createFixture();
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
    expect(first.totalPages).toBe(2);

    const second = await listUserSubmissions({
      actor: actorOf(owner),
      limit: 50,
      page: 2,
      snapshot: first.snapshot,
    });
    expect(second.items.map((item) => item.id)).toEqual(ids.slice(0, 2).reverse());
    expect(second.nextCursor).toBeNull();
  });

  it("rejects nonexistent and out-of-scope snapshot anchors with one generic 400", async () => {
    const { owner, rows } = await createFixture();

    const first = await listUserSubmissions({ actor: actorOf(owner), limit: 50 });
    const validSnapshot = JSON.parse(Buffer.from(first.snapshot, "base64url").toString("utf8"));
    for (const anchor of [
      "submission_does_not_exist",
      rows.practice.id,
      rows.otherExam.id,
      rows.otherUser.id,
    ]) {
      await expect(
        listUserSubmissions({
          actor: actorOf(owner),
          limit: 50,
          snapshot: Buffer.from(JSON.stringify({ ...validSnapshot, id: anchor })).toString(
            "base64url",
          ),
        }),
      ).rejects.toMatchObject({
        name: ValidationError.name,
        message: "Invalid submission snapshot.",
        status: 400,
      });
    }
  });
});

describe("workspace submission history pagination", () => {
  it("reads every page with tied timestamps and rejects cross-problem, cross-user and cross-exam cursors", async () => {
    const { owner, problem, examA, examB, rows } = await createFixture();
    const otherProblem = await createTestProblem();
    const outside = await createTestSubmission({
      userId: owner.id,
      problemId: otherProblem.id,
      examId: examA.id,
    });
    await testPrisma.submission.delete({ where: { id: rows.currentExam.id } });
    const expected = Array.from(
      { length: 151 },
      (_, i) => `workspace_page_${String(i).padStart(3, "0")}`,
    );
    for (const id of expected) {
      await createTestSubmission({
        id,
        userId: owner.id,
        problemId: problem.id,
        examId: examA.id,
        createdAt: new Date("2026-09-21T00:00:00Z"),
        status: "accepted",
        score: 100,
      });
    }
    const options = {
      actor: actorOf(owner),
      problemId: problem.id,
      context: { type: "exam" as const, examId: examA.id },
    };
    let cursor: string | undefined;
    const actual: string[] = [];
    const pageSizes: number[] = [];
    do {
      const page = await submissionDomain.listWorkspaceSubmissions({
        ...options,
        ...(cursor ? { cursor } : {}),
      });
      actual.push(...page.items.map((row) => row.id));
      pageSizes.push(page.items.length);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(pageSizes).toEqual([50, 50, 50, 1]);
    expect(actual).toEqual(expected.reverse());
    for (const cursor of [outside.id, rows.otherUser.id, rows.otherExam.id, "missing"]) {
      await expect(
        submissionDomain.listWorkspaceSubmissions({ ...options, cursor }),
      ).rejects.toMatchObject({ status: 400 });
    }
    await expect(
      submissionDomain.listWorkspaceSubmissions({
        ...options,
        context: { type: "exam", examId: examB.id },
      }),
    ).resolves.toEqual({ items: [], nextCursor: null });
  });
});

describe("numbered history snapshots against the real database", () => {
  it.each(["owner", "teacher"] as const)(
    "keeps all 151 tied rows reachable for %s while newer submissions wait outside the snapshot",
    async (reader) => {
      const teacher = await createTestUser({ platformRole: "teacher" });
      const student = await createTestUser();
      const course = await createTestCourse({ ownerId: teacher.id });
      const exam = await createTestExam({ courseId: course.id });
      const otherExam = await createTestExam({ courseId: course.id });
      const problem = await createTestProblem({ authorId: teacher.id });
      const createdAt = new Date(Date.now() - 60_000);
      const ids = Array.from(
        { length: 151 },
        (_, index) => `snapshot_${String(index).padStart(3, "0")}`,
      );
      for (const id of ids)
        await createTestSubmission({
          id,
          userId: student.id,
          problemId: problem.id,
          examId: exam.id,
          createdAt,
          status: "accepted",
        });
      await createTestSubmission({
        id: "outside_exam",
        userId: student.id,
        problemId: problem.id,
        examId: otherExam.id,
        createdAt,
      });
      await testPrisma.activeExamSession.create({
        data: { userId: student.id, examId: exam.id },
      });
      const actor = actorOf(reader === "owner" ? student : teacher);
      const read = (page = 1, snapshot?: string) => {
        const options = {
          actor,
          limit: 50,
          page,
          filters: { problemId: problem.id },
          ...(snapshot ? { snapshot } : {}),
        };
        return reader === "owner"
          ? submissionDomain.listUserSubmissions(options)
          : submissionDomain.listContextSubmissionsPaged({
              ...options,
              context: { type: "exam", id: exam.id },
            });
      };
      const first = await read();
      expect(first).toMatchObject({ page: 1, totalPages: 4, totalCount: 151, newCount: 0 });
      const expected = [...ids].reverse();
      expect(first.items.map((row) => row.id)).toEqual(expected.slice(0, 50));

      await createTestSubmission({
        id: "zz_same_timestamp",
        userId: student.id,
        problemId: problem.id,
        examId: exam.id,
        createdAt,
      });
      await createTestSubmission({
        id: "newer_timestamp",
        userId: student.id,
        problemId: problem.id,
        examId: exam.id,
        createdAt: new Date(createdAt.getTime() + 1_000),
      });
      const actual = first.items.map((row) => row.id);
      for (let page = 2; page <= 4; page += 1) {
        const next = await read(page, first.snapshot);
        expect(next).toMatchObject({
          page,
          snapshot: first.snapshot,
          totalPages: 4,
          totalCount: 151,
          newCount: 2,
        });
        expect(next.items).toHaveLength(page === 4 ? 1 : 50);
        actual.push(...next.items.map((row) => row.id));
      }
      expect(actual).toEqual(expected);
      expect(new Set(actual).size).toBe(151);
      const stillFirst = await read(1, first.snapshot);
      expect(stillFirst.items.map((row) => row.id)).toEqual(first.items.map((row) => row.id));
      expect(stillFirst.newCount).toBe(2);
      const latest = await read();
      expect(latest).toMatchObject({ totalCount: 153, newCount: 0 });
      expect(latest.items.slice(0, 2).map((row) => row.id)).toEqual([
        "newer_timestamp",
        "zz_same_timestamp",
      ]);
    },
    30_000,
  );

  it("rejects a teacher snapshot when moved to a different authorized exam", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });
    const examA = await createTestExam({ courseId: course.id });
    const examB = await createTestExam({ courseId: course.id });
    const problem = await createTestProblem({ authorId: teacher.id });
    await createTestSubmission({ problemId: problem.id, examId: examA.id });
    const options = { actor: actorOf(teacher), limit: 50 };
    const first = await submissionDomain.listContextSubmissionsPaged({
      ...options,
      context: { type: "exam", id: examA.id },
    });
    await expect(
      submissionDomain.listContextSubmissionsPaged({
        ...options,
        context: { type: "exam", id: examB.id },
        snapshot: first.snapshot,
      }),
    ).rejects.toMatchObject({ status: 400, message: "Invalid submission snapshot." });
  });
});
