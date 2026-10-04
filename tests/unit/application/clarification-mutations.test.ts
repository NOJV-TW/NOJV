import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  clarificationFindById,
  clarificationSoftDelete,
  clarificationCreate,
  clarificationUpdateAnswer,
  clarificationUpdateState,
  clarificationCountInWindow,
  contestFindById,
  examFindById,
  assessmentFindByIdWithCourseId,
  courseMembershipFindByComposite,
  courseLock,
  courseFindById,
  publishClarification,
} = vi.hoisted(() => ({
  clarificationFindById: vi.fn(),
  clarificationSoftDelete: vi.fn(),
  clarificationCreate: vi.fn(),
  clarificationUpdateAnswer: vi.fn(),
  clarificationUpdateState: vi.fn(),
  clarificationCountInWindow: vi.fn(),
  contestFindById: vi.fn(),
  examFindById: vi.fn(),
  assessmentFindByIdWithCourseId: vi.fn(),
  courseMembershipFindByComposite: vi.fn(),
  courseLock: vi.fn(),
  courseFindById: vi.fn(),
  publishClarification: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({}),
  clarificationRepo: {
    findById: clarificationFindById,
    countInWindow: clarificationCountInWindow,
    listForContext: vi.fn(),
    withTx: () => ({
      create: clarificationCreate,
      updateAnswer: clarificationUpdateAnswer,
      updateState: clarificationUpdateState,
      softDelete: clarificationSoftDelete,
    }),
  },
  courseRepo: { withTx: () => ({ lockForUpdate: courseLock, findById: courseFindById }) },
  contestRepo: { findById: contestFindById },
  examRepo: { findById: examFindById, withTx: () => ({ findById: examFindById }) },
  assessmentRepo: {
    findByIdWithCourseId: assessmentFindByIdWithCourseId,
    withTx: () => ({ findById: assessmentFindByIdWithCourseId }),
  },
  courseMembershipRepo: { findByComposite: courseMembershipFindByComposite },
  participationRepo: {
    listContestParticipantUserIds: vi.fn(),
    listExamParticipantUserIds: vi.fn(),
  },
  assessmentProblemRepo: { exists: vi.fn() },
  contestProblemRepo: { existsById: vi.fn() },
  examProblemRepo: { exists: vi.fn() },
}));

vi.mock("@nojv/redis", () => ({
  pubsub: { publishClarification },
}));

import {
  answer,
  ask,
  deleteClarification,
  dismiss,
} from "../../../packages/application/src/clarification/mutations";

function actor(
  overrides: Partial<{
    userId: string;
    platformRole: "admin" | "teacher" | "student";
  }> = {},
) {
  return {
    userId: overrides.userId ?? "usr_actor",
    username: "actor",
    platformRole: overrides.platformRole ?? ("student" as const),
    displayName: "Actor",
    email: "actor@example.com",
  };
}

const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

function clarificationRow(
  overrides: Partial<{
    id: string;
    contextType: "contest" | "exam" | "assignment";
    contextId: string;
    askedByUserId: string;
    deletedAt: Date | null;
    isPublic: boolean;
  }> = {},
) {
  return {
    id: "clr_1",
    contextType: "contest" as const,
    contextId: "ctst_1",
    problemId: null,
    askedByUserId: "usr_asker",
    questionText: "How does this work?",
    answerText: null,
    state: "pending" as const,
    isPublic: true,
    answeredByUserId: null,
    answeredAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
    askedBy: { id: "usr_asker", username: "asker", name: "Asker" },
    answeredBy: null,
    problem: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  contestFindById.mockResolvedValue({
    id: "ctst_1",
    createdByUserId: "usr_organizer",
    startsAt: past,
    endsAt: future,
  });
  clarificationSoftDelete.mockImplementation((id: string) =>
    Promise.resolve(clarificationRow({ id, deletedAt: new Date() })),
  );
});

describe("deleteClarification", () => {
  it("lets the original asker delete their own thread", async () => {
    clarificationFindById.mockResolvedValue(clarificationRow({ askedByUserId: "usr_asker" }));

    await deleteClarification(actor({ userId: "usr_asker" }), "clr_1");

    expect(clarificationSoftDelete).toHaveBeenCalledWith("clr_1");
  });

  it("lets the contest organizer (staff) delete any thread", async () => {
    clarificationFindById.mockResolvedValue(clarificationRow({ askedByUserId: "usr_asker" }));

    await deleteClarification(actor({ userId: "usr_organizer" }), "clr_1");

    expect(clarificationSoftDelete).toHaveBeenCalledWith("clr_1");
  });

  it("lets a platform admin delete any thread", async () => {
    clarificationFindById.mockResolvedValue(clarificationRow({ askedByUserId: "usr_asker" }));

    await deleteClarification(actor({ userId: "usr_admin", platformRole: "admin" }), "clr_1");

    expect(clarificationSoftDelete).toHaveBeenCalledWith("clr_1");
  });

  it("forbids an unrelated participant from deleting someone else's thread", async () => {
    clarificationFindById.mockResolvedValue(clarificationRow({ askedByUserId: "usr_asker" }));

    await expect(
      deleteClarification(actor({ userId: "usr_intruder" }), "clr_1"),
    ).rejects.toMatchObject({ name: "ForbiddenError", status: 403 });
    expect(clarificationSoftDelete).not.toHaveBeenCalled();
  });

  it("returns NotFoundError for a missing clarification", async () => {
    clarificationFindById.mockResolvedValue(null);

    await expect(
      deleteClarification(actor({ userId: "usr_asker" }), "clr_missing"),
    ).rejects.toMatchObject({ name: "NotFoundError", status: 404 });
    expect(clarificationSoftDelete).not.toHaveBeenCalled();
  });

  it("treats double-delete as 404 (idempotent NotFoundError on the second call)", async () => {
    clarificationFindById.mockResolvedValue(
      clarificationRow({ askedByUserId: "usr_asker", deletedAt: new Date() }),
    );

    await expect(
      deleteClarification(actor({ userId: "usr_asker" }), "clr_1"),
    ).rejects.toMatchObject({ name: "NotFoundError", status: 404 });
    expect(clarificationSoftDelete).not.toHaveBeenCalled();
  });

  it("broadcasts a public row's deletion to peers on the public channel", async () => {
    clarificationFindById.mockResolvedValue(clarificationRow({ askedByUserId: "usr_asker" }));
    clarificationSoftDelete.mockResolvedValue(
      clarificationRow({ isPublic: true, deletedAt: new Date() }),
    );

    await deleteClarification(actor({ userId: "usr_asker" }), "clr_1");

    expect(publishClarification).toHaveBeenCalledWith(
      "contest",
      "ctst_1",
      expect.objectContaining({ action: "deleted" }),
      "public",
    );
  });

  it("routes a private/pending row's deletion to the staff-only channel", async () => {
    clarificationFindById.mockResolvedValue(clarificationRow({ askedByUserId: "usr_asker" }));
    clarificationSoftDelete.mockResolvedValue(
      clarificationRow({ isPublic: false, deletedAt: new Date() }),
    );

    await deleteClarification(actor({ userId: "usr_asker" }), "clr_1");

    expect(publishClarification).toHaveBeenCalledWith(
      "contest",
      "ctst_1",
      expect.objectContaining({ action: "deleted" }),
      "staff",
    );
  });
});

describe("archived course clarifications", () => {
  const readOnly = { name: "ValidationError", message: "Archived courses are read-only." };
  const answerInput = { answerText: "Yes.", isPublic: true };

  beforeEach(() => {
    assessmentFindByIdWithCourseId.mockResolvedValue({
      id: "ca_1",
      courseId: "crs_1",
      status: "published",
      opensAt: past,
      closesAt: future,
    });
    examFindById.mockResolvedValue({
      id: "exm_1",
      courseId: "crs_1",
      startsAt: past,
      endsAt: future,
    });
    courseFindById.mockResolvedValue({ id: "crs_1", archived: true });
    clarificationCountInWindow.mockResolvedValue(0);
  });

  it("rejects a student question in an assignment", async () => {
    courseMembershipFindByComposite.mockResolvedValue({ role: "student", status: "active" });
    await expect(
      ask(actor({ userId: "usr_student" }), {
        context: { type: "assignment", assignmentId: "ca_1" },
        questionText: "Is the input sorted?",
      }),
    ).rejects.toMatchObject(readOnly);
    expect(courseLock).toHaveBeenCalledWith("crs_1");
    expect(clarificationCreate).not.toHaveBeenCalled();
    expect(publishClarification).not.toHaveBeenCalled();
  });

  it.each([
    ["answer", (id: string) => answer(actor({ userId: "usr_ta" }), id, answerInput)],
    ["dismiss", (id: string) => dismiss(actor({ userId: "usr_ta" }), id)],
    ["delete", (id: string) => deleteClarification(actor({ userId: "usr_ta" }), id)],
  ])("rejects staff %s in an exam", async (_label, mutate) => {
    courseMembershipFindByComposite.mockResolvedValue({ role: "ta", status: "active" });
    clarificationFindById.mockResolvedValue(
      clarificationRow({ contextType: "exam", contextId: "exm_1" }),
    );
    await expect(mutate("clr_1")).rejects.toMatchObject(readOnly);
    expect(courseLock).toHaveBeenCalledWith("crs_1");
    expect(clarificationUpdateAnswer).not.toHaveBeenCalled();
    expect(clarificationUpdateState).not.toHaveBeenCalled();
    expect(clarificationSoftDelete).not.toHaveBeenCalled();
    expect(publishClarification).not.toHaveBeenCalled();
  });

  it("leaves contest clarifications unaffected", async () => {
    clarificationFindById.mockResolvedValue(clarificationRow({ askedByUserId: "usr_asker" }));
    await deleteClarification(actor({ userId: "usr_asker" }), "clr_1");
    expect(courseLock).not.toHaveBeenCalled();
    expect(clarificationSoftDelete).toHaveBeenCalledWith("clr_1");
  });
});
