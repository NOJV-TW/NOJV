import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const submission = {
    id: "submission",
    userId: "student",
    problemId: "problem",
    contestId: null as string | null,
    assessmentId: "assignment" as string | null,
    examId: null as string | null,
    status: "accepted",
    isReferenceSolution: false,
  };
  const current = { ...submission };
  const membership = { role: "teacher", status: "active" };
  const contest = { createdByUserId: "teacher" };
  const problem = { authorId: "teacher", storageGeneration: 1 };
  const user = { platformRole: "teacher", disabled: false };
  const lock = vi
    .fn<(query: TemplateStringsArray | string, ...params: unknown[]) => Promise<unknown[]>>()
    .mockResolvedValue([]);
  const tx = {
    $queryRaw: lock,
    user: { findUnique: vi.fn(() => Promise.resolve({ ...user })) },
    problem: {
      findUnique: vi.fn(() => Promise.resolve({ ...problem })),
      findUniqueOrThrow: vi.fn(() => Promise.resolve({ storageGeneration: 1 })),
    },
    submission: {
      findUniqueOrThrow: vi.fn(() => Promise.resolve({ ...current })),
      findFirst: vi.fn(() => Promise.resolve(null)),
    },
    assessment: { findUnique: vi.fn(() => Promise.resolve({ courseId: "course" })) },
    exam: { findUnique: vi.fn(() => Promise.resolve({ courseId: "course" })) },
  };
  return {
    submission,
    current,
    membership,
    contest,
    problem,
    user,
    lock,
    tx,
    prepare: vi.fn(),
    create: vi.fn(),
    enqueue: vi.fn(),
    target: {
      submissionId: submission.id,
      studentId: submission.userId,
      draft: { problemId: submission.problemId, language: "python", sampleOnly: false },
    },
  };
});

vi.mock("@nojv/db", () => ({
  prismaAdapterClient: {
    submission: { findMany: vi.fn(() => Promise.resolve([{ ...h.submission }])) },
    $transaction: vi.fn((callback: (tx: typeof h.tx) => Promise<unknown>) => callback(h.tx)),
  },
  durableWorkRepo: { withTx: () => ({ enqueue: h.enqueue }) },
  courseRepo: { withTx: () => ({ lockForUpdate: h.lock }) },
  courseMembershipRepo: {
    findByComposite: vi.fn(() => Promise.resolve({ role: "teacher", status: "active" })),
    withTx: () => ({ findByComposite: vi.fn(() => Promise.resolve({ ...h.membership })) }),
  },
  assessmentRepo: {
    findByIdWithCourseId: vi.fn(() => Promise.resolve({ courseId: "course" })),
    withTx: () => ({ findById: h.tx.assessment.findUnique, lockForUpdate: h.lock }),
  },
  examRepo: {
    findById: vi.fn(() => Promise.resolve({ courseId: "course" })),
    withTx: () => ({ findById: h.tx.exam.findUnique, lockForUpdate: h.lock }),
  },
  contestRepo: {
    findById: vi.fn(() => Promise.resolve({ createdByUserId: "teacher" })),
    withTx: () => ({
      findById: vi.fn(() => Promise.resolve({ ...h.contest })),
      lockForUpdate: h.lock,
    }),
  },
  problemRepo: {
    findById: h.tx.problem.findUnique,
    withTx: () => ({ findById: h.tx.problem.findUnique }),
  },
  submissionRepo: { anyWithContextForProblem: vi.fn(() => Promise.resolve(false)) },
}));

vi.mock("../../../packages/application/src/submission/judge-context", () => ({
  findOneForRejudge: vi.fn(() => Promise.resolve(h.target)),
  listForRejudge: vi.fn(() => Promise.resolve([h.target])),
}));
vi.mock("../../../packages/application/src/submission/judge-snapshot", () => ({
  prepareJudgeSnapshot: h.prepare,
}));
vi.mock("../../../packages/application/src/submission/judge-execution", () => ({
  createJudgeExecution: h.create,
}));
vi.mock("../../../packages/application/src/submission/judge-recovery", () => ({}));

import { dispatchRejudge } from "../../../packages/application/src/submission/rejudge-control";

const actor = { userId: "teacher", platformRole: "teacher" as const };
const single = {
  mode: "single" as const,
  submissionId: "submission",
  triggeredByUserId: actor.userId,
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(h.submission, { contestId: null, assessmentId: "assignment", examId: null });
  Object.assign(h.current, h.submission);
  Object.assign(h.membership, { role: "teacher", status: "active" });
  Object.assign(h.contest, { createdByUserId: actor.userId });
  Object.assign(h.problem, { authorId: actor.userId, storageGeneration: 1 });
  Object.assign(h.user, { platformRole: "teacher", disabled: false });
  h.prepare.mockResolvedValue({ pointer: {}, problemGeneration: 1 });
});

describe("rejudge commit authority", () => {
  it.each(["removed", "role change"])(
    "rejects course staff %s during preparation",
    async (change) => {
      h.prepare.mockImplementationOnce(() => {
        if (change === "removed") h.membership.status = "removed";
        else h.membership.role = "student";
        return Promise.resolve({ pointer: {}, problemGeneration: 1 });
      });
      await expect(dispatchRejudge(single, actor)).rejects.toMatchObject({ status: 403 });
      expect(h.create).not.toHaveBeenCalled();
      expect(h.enqueue).not.toHaveBeenCalled();
    },
  );

  it("rejects a batch after its organizer changes during preparation", async () => {
    Object.assign(h.submission, { contestId: "contest", assessmentId: null });
    Object.assign(h.current, h.submission);
    h.prepare.mockImplementationOnce(() => {
      h.contest.createdByUserId = "other";
      return Promise.resolve({ pointer: {}, problemGeneration: 1 });
    });
    await expect(
      dispatchRejudge(
        {
          mode: "batch",
          problemId: "problem",
          contestId: "contest",
          triggeredByUserId: actor.userId,
        },
        actor,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(h.create).not.toHaveBeenCalled();
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it("rejects a target that moves to another scope during preparation", async () => {
    h.prepare.mockImplementationOnce(() => {
      h.current.assessmentId = "other-assignment";
      return Promise.resolve({ pointer: {}, problemGeneration: 1 });
    });
    await expect(dispatchRejudge(single, actor)).rejects.toMatchObject({ status: 409 });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("rejects a disabled requester during preparation", async () => {
    h.prepare.mockImplementationOnce(() => {
      h.user.disabled = true;
      return Promise.resolve({ pointer: {}, problemGeneration: 1 });
    });
    await expect(dispatchRejudge(single, actor)).rejects.toMatchObject({ status: 403 });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("rejects a problem ownership change without a storage generation change", async () => {
    Object.assign(h.submission, { assessmentId: null });
    Object.assign(h.current, h.submission);
    h.prepare.mockImplementationOnce(() => {
      h.problem.authorId = "other";
      return Promise.resolve({ pointer: {}, problemGeneration: 1 });
    });
    await expect(dispatchRejudge(single, actor)).rejects.toMatchObject({ status: 403 });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("does not elevate an inactive admin actor from the stored role", async () => {
    h.user.platformRole = "admin";
    h.membership.status = "removed";
    await expect(
      dispatchRejudge(single, { ...actor, platformRole: "student" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("rejects revoked administrator authority", async () => {
    await expect(
      dispatchRejudge(single, { ...actor, platformRole: "admin" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("rejects a requester identity that does not match the trusted actor", async () => {
    await expect(dispatchRejudge(single, { ...actor, userId: "other" })).rejects.toMatchObject({
      status: 403,
    });
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it("locks scoped resources before the requester so roster binding cannot deadlock", async () => {
    const { workflowId } = await dispatchRejudge(single, actor);
    expect(workflowId).toMatch(/^rejudge-/);
    expect(h.create).toHaveBeenCalledOnce();
    expect(h.enqueue).toHaveBeenCalledOnce();
    const locks = h.lock.mock.calls.map((call) =>
      typeof call[0] === "string" ? call[0] : call[0].join("?"),
    );
    expect(locks).toEqual([
      "course",
      expect.stringContaining('FROM "CourseMembership"'),
      "assignment",
      expect.stringContaining('FROM "Problem"'),
      expect.stringContaining('FROM "Submission"'),
      expect.stringContaining('FROM "User"'),
    ]);
    expect(h.lock.mock.invocationCallOrder.at(-1)).toBeLessThan(
      h.create.mock.invocationCallOrder[0],
    );
  });
});
