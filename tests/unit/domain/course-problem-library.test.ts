import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TransactionClient } from "@nojv/db";

const mocks = vi.hoisted(() => {
  const course = vi.fn();
  const membership = vi.fn();
  const courseLock = vi.fn();
  const problemLock = vi.fn();
  const add = vi.fn();
  const remove = vi.fn();
  const problemFindMany = vi.fn();
  const assignment = vi.fn();
  const exam = vi.fn();
  const activityLock = vi.fn();
  const attach = vi.fn();
  const detach = vi.fn();
  const update = vi.fn();
  const tx = {
    $queryRaw: vi.fn(),
    courseProblem: { findMany: vi.fn() },
    problem: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    assessment: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), update },
    exam: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), update },
    participation: { findMany: vi.fn() },
    assessmentProblem: {
      findMany: vi.fn(),
      upsert: attach,
      deleteMany: detach,
      updateMany: vi.fn(),
    },
    examProblem: { findMany: vi.fn(), upsert: attach, deleteMany: detach, updateMany: vi.fn() },
    contestProblem: { findMany: vi.fn() },
    scoreOverrideAuditLog: { findMany: vi.fn() },
    submissionFeedbackAuditLog: { findMany: vi.fn() },
  };
  return {
    course,
    membership,
    courseLock,
    problemLock,
    add,
    remove,
    problemFindMany,
    assignment,
    exam,
    activityLock,
    attach,
    detach,
    update,
    tx,
    picker: vi.fn(),
  };
});

vi.mock("@nojv/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@nojv/db")>()).Prisma,
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(mocks.tx),
  courseRepo: { withTx: () => ({ findById: mocks.course, lockForUpdate: mocks.courseLock }) },
  courseMembershipRepo: { withTx: () => ({ findByComposite: mocks.membership }) },
  courseProblemRepo: {
    withTx: (tx: unknown) => {
      expect(tx).toBe(mocks.tx);
      return { add: mocks.add, remove: mocks.remove, lockProblem: mocks.tx.problem.findUnique };
    },
  },
  problemRepo: {
    withTx: (tx: unknown) => {
      expect(tx).toBe(mocks.tx);
      return { findMany: mocks.problemFindMany, lockForUpdate: mocks.problemLock };
    },
  },
  userRepo: { withTx: () => ({ findById: vi.fn().mockResolvedValue({ id: "staff" }) }) },
  assessmentRepo: {
    withTx: () => ({
      findById: mocks.assignment,
      lockForUpdate: mocks.activityLock,
      update: mocks.update,
    }),
  },
  examRepo: {
    withTx: () => ({
      findById: mocks.exam,
      lockForUpdate: mocks.activityLock,
      update: mocks.update,
    }),
  },
  contestRepo: {
    withTx: () => ({
      findById: mocks.exam,
      lockForUpdate: mocks.activityLock,
      update: mocks.update,
    }),
  },
  assessmentProblemRepo: {
    withTx: () => ({ create: mocks.attach, deleteByAssessmentId: mocks.detach }),
  },
  examProblemRepo: { withTx: () => ({ create: mocks.attach, deleteByExamId: mocks.detach }) },
  contestProblemRepo: {
    withTx: () => ({ create: mocks.attach, deleteByContestId: mocks.detach }),
  },
  testcaseSetRepo: {
    withTx: () => ({ findByProblemId: vi.fn().mockResolvedValue([{ weight: 100 }]) }),
  },
}));

vi.mock("../../../packages/application/src/problem/queries", () => ({
  listProblemPickerGroups: mocks.picker,
  mapProblemPickerCandidate: (problem: Record<string, unknown>) => ({
    id: problem.id,
    title: problem.title,
    displayId: problem.displayId,
    status: problem.status,
    visibility: problem.visibility,
    difficulty: problem.difficulty,
    judgeType: "standard",
    type: problem.type,
    tags: problem.tags,
  }),
}));

import {
  addCourseProblems,
  getCourseProblemLibrary,
  listCourseProblemPickerGroups,
  removeCourseProblem,
} from "../../../packages/application/src/course/problem-library";
import { resolveActivityProblems } from "../../../packages/application/src/problem/fork";
import {
  updateAssignmentRecord,
  publishAssignment,
  deleteAssignmentDraft,
  revertAssignmentToDraft,
} from "../../../packages/application/src/assignment/mutations";
import {
  createExamRecord,
  updateExamRecord,
  publishExam,
  deleteExamDraft,
} from "../../../packages/application/src/exam/mutations";
import { updateContestRecord } from "../../../packages/application/src/contest/mutations";

const actor = {
  userId: "staff",
  username: "staff",
  platformRole: "student" as const,
  displayName: "Staff",
  email: "staff@example.test",
};
const admin = { ...actor, platformRole: "admin" as const };
const transaction = mocks.tx as unknown as TransactionClient;

function problem(id = "private", extra: Record<string, unknown> = {}) {
  return {
    id,
    authorId: actor.userId,
    title: id,
    visibility: "private",
    status: "draft",
    displayId: null,
    type: "full_source",
    difficulty: "easy",
    tags: [],
    judgeConfig: { type: "standard" },
    storageGeneration: 0,
    activeStorageBytes: 0,
    statement: null,
    testcaseSets: [],
    workspaceFiles: [],
    referenceSolutionSubmission: null,
    ...extra,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.course.mockImplementation((id: string) => ({
    id,
    title: "Course",
    archived: false,
  }));
  mocks.membership.mockResolvedValue({ userId: actor.userId, role: "ta", status: "active" });
  mocks.problemFindMany.mockResolvedValue([problem()]);
  mocks.tx.problem.findUnique.mockResolvedValue(problem());
  mocks.tx.problem.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
    id: "fork",
    ...data,
  }));
  mocks.tx.problem.findMany.mockResolvedValue([]);
  mocks.tx.courseProblem.findMany.mockResolvedValue([]);
  mocks.tx.assessment.findUnique.mockResolvedValue({ courseId: "course" });
  mocks.tx.exam.findUnique.mockResolvedValue({ courseId: "course" });
  mocks.tx.assessment.findMany.mockResolvedValue([
    { id: "assignment", detachedProblemIds: [] },
  ]);
  mocks.tx.exam.findMany.mockResolvedValue([{ id: "exam", detachedProblemIds: [] }]);
  mocks.tx.assessmentProblem.findMany.mockResolvedValue([]);
  mocks.tx.examProblem.findMany.mockResolvedValue([]);
  mocks.tx.contestProblem.findMany.mockResolvedValue([]);
  mocks.tx.scoreOverrideAuditLog.findMany.mockResolvedValue([]);
  mocks.tx.submissionFeedbackAuditLog.findMany.mockResolvedValue([]);
  mocks.picker.mockResolvedValue({ personalProblems: [], publicProblems: [] });
  const activity = {
    id: "activity",
    courseId: "course",
    createdByUserId: actor.userId,
    title: "Activity",
    status: "draft",
    visibility: "draft",
    allowedLanguages: [],
    opensAt: new Date("2030-01-01"),
    closesAt: new Date("2030-01-10"),
    startsAt: new Date("2030-01-01"),
    endsAt: new Date("2030-01-10"),
    dueAt: null,
    adjustmentRules: [],
    totalPoints: 100,
    gradingRevision: 0,
    detachedProblemIds: [],
  };
  mocks.assignment.mockResolvedValue(activity);
  mocks.exam.mockResolvedValue(activity);
  mocks.tx.assessment.findUniqueOrThrow.mockImplementation(async () => ({
    ...activity,
    problems: await mocks.tx.assessmentProblem.findMany(),
  }));
  mocks.tx.exam.findUniqueOrThrow.mockImplementation(async () => ({
    ...activity,
    problems: await mocks.tx.examProblem.findMany(),
  }));
  mocks.tx.participation.findMany.mockResolvedValue([]);
});

describe("course problem library authorization", () => {
  it.each([null, { role: "ta", status: "removed" }, { role: "student", status: "active" }])(
    "rejects nonstaff library reads and writes: %j",
    async (membership) => {
      mocks.membership.mockResolvedValue(membership);
      await expect(getCourseProblemLibrary(actor, "course")).rejects.toThrow(/permission/);
      await expect(addCourseProblems(actor, "course", ["private"])).rejects.toThrow(
        /permission/,
      );
      await expect(listCourseProblemPickerGroups(actor, "course")).rejects.toThrow(
        /permission/,
      );
      expect(mocks.add).not.toHaveBeenCalled();
      expect(mocks.picker).not.toHaveBeenCalled();
      expect(mocks.membership).toHaveBeenCalledWith("course", actor.userId);
    },
  );

  it("permits active bound TAs and active admins; archived libraries remain read-only", async () => {
    mocks.course.mockResolvedValue({ id: "course", title: "Course", archived: true });
    expect((await getCourseProblemLibrary(actor, "course")).course.archived).toBe(true);
    await expect(addCourseProblems(actor, "course", [])).rejects.toThrow(/read-only/);
    await expect(removeCourseProblem(actor, "course", "private")).rejects.toThrow(/read-only/);
    mocks.membership.mockResolvedValue(null);
    await expect(getCourseProblemLibrary(admin, "course")).resolves.toMatchObject({
      problems: [],
    });
    await expect(addCourseProblems(admin, "course", ["private"])).rejects.toThrow(/read-only/);
  });

  it("returns the exact library shape and course-scoped activity titles", async () => {
    mocks.tx.courseProblem.findMany.mockResolvedValue([
      {
        problem: {
          id: "private",
          displayId: null,
          title: "Private",
          status: "draft",
          visibility: "private",
          author: { id: "owner", name: "Owner", username: "owner" },
          forkedFromProblemId: "public",
          assessmentLinks: [{ assessment: { id: "assignment", title: "Homework" } }],
          examLinks: [],
        },
      },
    ]);
    mocks.tx.problem.findMany.mockResolvedValue([{ id: "private" }]);
    expect(await getCourseProblemLibrary(actor, "course")).toEqual({
      course: { id: "course", title: "Course", archived: false },
      problems: [
        {
          id: "private",
          displayId: null,
          title: "Private",
          status: "draft",
          visibility: "private",
          author: { id: "owner", name: "Owner", username: "owner" },
          forkedFromProblemId: "public",
          canEdit: true,
          canRemove: false,
          assignments: [{ id: "assignment", title: "Homework" }],
          exams: [],
        },
      ],
    });
    expect(mocks.tx.courseProblem.findMany.mock.calls[0][0] as unknown).toMatchObject({
      where: { courseId: "course" },
      select: {
        problem: {
          select: {
            assessmentLinks: { where: { assessment: { courseId: "course" } } },
            examLinks: { where: { exam: { courseId: "course" } } },
          },
        },
      },
    });
  });
});

describe("activity selection and sharing", () => {
  it("adds owned private once and returns stable IDs in input order", async () => {
    expect(await addCourseProblems(actor, "course", ["private", "private"])).toEqual({
      problemIds: ["private"],
    });
    expect(mocks.add).toHaveBeenCalledExactlyOnceWith("course", "private", actor.userId);
    expect(mocks.courseLock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.problemLock.mock.invocationCallOrder[0],
    );
    expect(mocks.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.problemLock.mock.invocationCallOrder[0],
    );
  });

  it("reuses a private shared by another owner and attributes the add to the actor", async () => {
    mocks.problemFindMany.mockResolvedValue([problem("shared", { authorId: "owner" })]);
    mocks.tx.courseProblem.findMany.mockResolvedValue([{ problemId: "shared" }]);
    expect(await addCourseProblems(actor, "course", ["shared"])).toEqual({
      problemIds: ["shared"],
    });
    expect(mocks.tx.problem.create).not.toHaveBeenCalled();
  });

  it.each([actor, admin])(
    "forbids unshared private even for nonowner admin: $platformRole",
    async (caller) => {
      mocks.problemFindMany.mockResolvedValue([problem("private", { authorId: "owner" })]);
      await expect(addCourseProblems(caller, "course", ["private"])).rejects.toThrow(/owner/);
      expect(mocks.add).not.toHaveBeenCalled();
    },
  );

  it.each([actor.userId, "other"])(
    "forks published public even when owned by %s",
    async (authorId) => {
      const source = problem("public", {
        authorId,
        visibility: "public",
        status: "published",
        displayId: 42,
      });
      mocks.problemFindMany.mockResolvedValue([source]);
      mocks.tx.problem.findUnique.mockResolvedValue(source);
      expect(await addCourseProblems(actor, "course", ["public", "public"])).toEqual({
        problemIds: ["fork"],
      });
      expect(mocks.tx.problem.create).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining<Record<string, unknown>>({
          data: expect.objectContaining<Record<string, unknown>>({
            authorId: actor.userId,
            visibility: "private",
            status: "draft",
            adminMayPublish: false,
            forkedFromProblemId: "public",
          }),
        }),
      );
      expect(mocks.add).toHaveBeenCalledWith("course", "fork", actor.userId);
    },
  );

  it("rejects draft public and missing IDs without adding a library link", async () => {
    const source = problem("public", { visibility: "public" });
    mocks.problemFindMany.mockResolvedValue([source]);
    mocks.tx.problem.findUnique.mockResolvedValue(source);
    await expect(addCourseProblems(actor, "course", ["public"])).rejects.toThrow(
      /published public/,
    );
    await expect(addCourseProblems(actor, "course", ["missing"])).rejects.toThrow(/not found/);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it.each(["owned", "shared"])(
    "rejects new %s private drafts in activities while allowing library adds",
    async (kind) => {
      mocks.problemFindMany.mockResolvedValue([
        problem("private", { authorId: kind === "owned" ? actor.userId : "other" }),
      ]);
      if (kind === "shared")
        mocks.tx.courseProblem.findMany.mockResolvedValue([{ problemId: "private" }]);
      await expect(
        resolveActivityProblems(transaction, actor, ["private"], { courseId: "course" }),
      ).rejects.toThrow(/Publish private problems/);
      expect(mocks.add).not.toHaveBeenCalled();
      await expect(addCourseProblems(actor, "course", ["private"])).resolves.toEqual({
        problemIds: ["private"],
      });
    },
  );

  it("uses a published shared private in a new activity without forking", async () => {
    mocks.problemFindMany.mockResolvedValue([
      problem("private", { authorId: "other", status: "published" }),
    ]);
    mocks.tx.courseProblem.findMany.mockResolvedValue([{ problemId: "private" }]);
    await expect(
      resolveActivityProblems(transaction, actor, ["private"], { courseId: "course" }),
    ).resolves.toEqual([expect.objectContaining({ id: "private" })]);
    expect(mocks.tx.problem.create).not.toHaveBeenCalled();
    expect(mocks.add).toHaveBeenCalledWith("course", "private", actor.userId);
  });

  it("does not share or fork when retaining DB-existing public/private references", async () => {
    mocks.problemFindMany.mockResolvedValue([
      problem("old-public", { authorId: "other", visibility: "public", displayId: 17 }),
      problem("old-private", { authorId: "other" }),
    ]);
    const rows = await resolveActivityProblems(
      transaction,
      actor,
      ["old-public", "old-private"],
      {
        courseId: "course",
        existingProblemIds: ["old-public", "old-private"],
      },
    );
    expect(rows.map(({ id }) => id)).toEqual(["old-public", "old-private"]);
    expect(mocks.tx.problem.create).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("does not authorize another course or a standalone contest using old sharing context", async () => {
    mocks.problemFindMany.mockResolvedValue([problem("shared", { authorId: "other" })]);
    await expect(
      resolveActivityProblems(transaction, actor, ["shared"], { courseId: "target" }),
    ).rejects.toThrow(/owner/);
    expect(mocks.tx.courseProblem.findMany).toHaveBeenCalledWith(
      expect.objectContaining<Record<string, unknown>>({
        where: { courseId: "target", problemId: { in: ["shared"] } },
      }),
    );
    await expect(resolveActivityProblems(transaction, actor, ["shared"])).rejects.toThrow(
      /owner/,
    );
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("propagates fork and link failures through the enclosing transaction", async () => {
    const source = problem("public", { visibility: "public", status: "published" });
    mocks.problemFindMany.mockResolvedValue([source]);
    mocks.tx.problem.findUnique.mockResolvedValue(source);
    mocks.tx.problem.create.mockRejectedValueOnce(new Error("fork failure"));
    await expect(addCourseProblems(actor, "course", ["public"])).rejects.toThrow(
      "fork failure",
    );
    expect(mocks.add).not.toHaveBeenCalled();
    mocks.add.mockRejectedValueOnce(new Error("link failure"));
    await expect(addCourseProblems(actor, "course", ["public"])).rejects.toThrow(
      "link failure",
    );
  });
});

describe("removing sharing", () => {
  it.each(["assignment", "exam"])(
    "keeps sharing while a detached %s reference can be restored",
    async (kind) => {
      const find =
        kind === "assignment" ? mocks.tx.assessment.findMany : mocks.tx.exam.findMany;
      find.mockResolvedValue([{ id: "activity", detachedProblemIds: ["private"] }]);
      await expect(removeCourseProblem(admin, "course", "private")).rejects.toThrow(
        /history references/,
      );
      expect(mocks.remove).not.toHaveBeenCalled();
    },
  );

  it.each(["staff", "owner", "admin"])(
    "allows %s removal only of the requested link",
    async (role) => {
      if (role !== "staff") mocks.membership.mockResolvedValue(null);
      mocks.tx.problem.findUnique.mockResolvedValue(
        problem("private", { authorId: role === "owner" ? actor.userId : "other" }),
      );
      await removeCourseProblem(role === "admin" ? admin : actor, "course", "private");
      expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("course", "private");
      expect(mocks.courseLock.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.tx.$queryRaw.mock.invocationCallOrder[0],
      );
      expect(mocks.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.tx.problem.findUnique.mock.invocationCallOrder[0],
      );
    },
  );

  it("rejects nonstaff nonowners", async () => {
    mocks.membership.mockResolvedValue(null);
    mocks.tx.problem.findUnique.mockResolvedValue(problem("private", { authorId: "other" }));
    await expect(removeCourseProblem(actor, "course", "private")).rejects.toThrow(/permission/);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it.each(["references", "score history", "feedback history"])(
    "blocks %s, including for admins",
    async (history) => {
      if (history === "references")
        mocks.tx.problem.findMany.mockResolvedValue([{ id: "private" }]);
      if (history === "score history")
        mocks.tx.scoreOverrideAuditLog.findMany.mockResolvedValue([{ problemId: "private" }]);
      if (history === "feedback history")
        mocks.tx.submissionFeedbackAuditLog.findMany.mockResolvedValue([
          { problemId: "private" },
        ]);
      await expect(removeCourseProblem(admin, "course", "private")).rejects.toThrow(
        /history references/,
      );
      expect(mocks.remove).not.toHaveBeenCalled();
    },
  );
});

describe("activity integration", () => {
  it.each([
    ["assignment update", () => updateAssignmentRecord(actor, "activity", { title: "Title" })],
    ["assignment publish", () => publishAssignment(actor, "activity")],
    ["assignment delete", () => deleteAssignmentDraft(actor, "activity")],
    ["assignment revert", () => revertAssignmentToDraft(actor, "activity")],
    ["exam update", () => updateExamRecord(actor, "activity", { title: "Title" })],
    ["exam publish", () => publishExam(actor, "activity")],
    ["exam delete", () => deleteExamDraft(actor, "activity")],
  ])("removed creator cannot perform %s", async (_label, operation) => {
    mocks.membership.mockResolvedValue({ userId: actor.userId, role: "ta", status: "removed" });
    await expect((operation as () => Promise<unknown>)()).rejects.toThrow(/permission/);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.activityLock).not.toHaveBeenCalled();
  });

  it.each(["removed", "archived"])(
    "rechecks %s access after waiting for the course lock",
    async (change) => {
      let release: (() => void) | undefined;
      const locked = new Promise<void>((resolve) => {
        release = resolve;
      });
      mocks.courseLock.mockReturnValueOnce(locked);
      const updating = updateAssignmentRecord(actor, "activity", {
        problems: [{ problemId: "private", points: 100 }],
        gradingRevision: 0,
      });
      await vi.waitFor(() => expect(mocks.courseLock).toHaveBeenCalled());
      expect(mocks.membership).not.toHaveBeenCalled();
      if (change === "removed")
        mocks.membership.mockResolvedValue({ role: "ta", status: "removed" });
      else mocks.course.mockResolvedValue({ id: "course", archived: true });
      release?.();
      await expect(updating).rejects.toThrow(change === "removed" ? /permission/ : /read-only/);
      expect(mocks.add).not.toHaveBeenCalled();
      expect(mocks.attach).not.toHaveBeenCalled();
    },
  );

  it("rejects a platform teacher without target-course membership when creating an exam", async () => {
    mocks.membership.mockResolvedValue(null);
    await expect(
      createExamRecord({ ...actor, platformRole: "teacher" }, {
        courseId: "course",
      } as Parameters<typeof createExamRecord>[1]),
    ).rejects.toThrow(/permission/);
  });

  it.each(["assignment", "exam", "contest"])(
    "preserves %s's DB references before replacement",
    async (kind) => {
      const old = problem("old-public", {
        visibility: "public",
        authorId: "other",
        status: "published",
        displayId: 91,
      });
      mocks.problemFindMany.mockResolvedValue([old]);
      const find =
        kind === "assignment"
          ? mocks.tx.assessmentProblem.findMany
          : kind === "exam"
            ? mocks.tx.examProblem.findMany
            : mocks.tx.contestProblem.findMany;
      find.mockResolvedValue([{ problemId: "old-public", points: 100 }]);
      if (kind === "assignment")
        await updateAssignmentRecord(actor, "activity", {
          problems: [{ problemId: "old-public", points: 50 }],
          gradingRevision: 0,
        });
      else if (kind === "exam")
        await updateExamRecord(actor, "activity", {
          problems: [{ problemId: "old-public", points: 50 }],
          gradingRevision: 0,
        });
      else
        await updateContestRecord(actor, "activity", {
          problems: [{ problemId: "old-public", points: 100 }],
        });
      expect(mocks.tx.problem.create).not.toHaveBeenCalled();
      expect(mocks.add).not.toHaveBeenCalled();
      expect(mocks.attach).toHaveBeenCalledWith(
        expect.objectContaining<Record<string, unknown>>(
          kind === "contest"
            ? { problemId: "old-public" }
            : { create: expect.objectContaining({ problemId: "old-public" }) },
        ),
      );
      expect(find.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.detach.mock.invocationCallOrder[0],
      );
      if (kind !== "contest")
        expect(mocks.courseLock.mock.invocationCallOrder[0]).toBeLessThan(
          mocks.activityLock.mock.invocationCallOrder[0],
        );
      expect(mocks.activityLock.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.problemLock.mock.invocationCallOrder[0],
      );
    },
  );

  it.each(["assignment", "exam"])(
    "ignores client-claimed existing IDs when updating %s",
    async (kind) => {
      mocks.problemFindMany.mockResolvedValue([problem("private", { authorId: "other" })]);
      const payload = {
        problems: [{ problemId: "private", points: 100 }],
        gradingRevision: 0,
        existingProblemIds: ["private"],
      };
      const updating =
        kind === "assignment"
          ? updateAssignmentRecord(actor, "activity", payload)
          : updateExamRecord(actor, "activity", payload);
      await expect(updating).rejects.toThrow(/owner/);
      expect(mocks.attach).not.toHaveBeenCalled();
      expect(mocks.add).not.toHaveBeenCalled();
    },
  );

  it.each(["assignment", "exam"])(
    "removing all %s problems retains CourseProblem",
    async (kind) => {
      const find =
        kind === "assignment"
          ? mocks.tx.assessmentProblem.findMany
          : mocks.tx.examProblem.findMany;
      find.mockResolvedValue([{ problemId: "private", points: 100 }]);
      const payload = { problems: [], gradingRevision: 0 };
      if (kind === "assignment") await updateAssignmentRecord(actor, "activity", payload);
      else await updateExamRecord(actor, "activity", payload);
      expect(mocks.detach).toHaveBeenCalledWith({
        where: {
          [kind === "assignment" ? "assessmentId" : "examId"]: "activity",
          problemId: { notIn: [] },
        },
      });
      expect(mocks.remove).not.toHaveBeenCalled();
    },
  );

  it("keeps existing public picker details alongside personal/public groups", async () => {
    const old = problem("old-public", {
      displayId: 91,
      visibility: "public",
      title: "Original",
    });
    mocks.tx.problem.findMany.mockResolvedValue([old]);
    const personal = [{ id: "mine" }];
    mocks.picker.mockResolvedValue({ personalProblems: personal, publicProblems: [] });
    const groups = await listCourseProblemPickerGroups(actor, "course", ["old-public"]);
    expect(groups.personalProblems).toEqual(personal);
    expect(groups.courseProblems).toEqual([
      expect.objectContaining<Record<string, unknown>>({
        id: "old-public",
        displayId: 91,
        title: "Original",
        visibility: "public",
      }),
    ]);
    expect(mocks.tx.problem.findMany).toHaveBeenCalledWith(
      expect.objectContaining<Record<string, unknown>>({
        where: {
          OR: [
            { status: "published", courseLinks: { some: { courseId: "course" } } },
            {
              id: { in: ["old-public"] },
              OR: [
                { assessmentLinks: { some: { assessment: { courseId: "course" } } } },
                { examLinks: { some: { exam: { courseId: "course" } } } },
              ],
            },
          ],
        },
      }),
    );
  });
});
