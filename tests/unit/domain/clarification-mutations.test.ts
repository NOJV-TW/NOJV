import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  clarificationFindById,
  clarificationSoftDelete,
  contestFindById,
  examFindById,
  assessmentFindByIdWithCourseId,
  courseMembershipFindByComposite,
  publishClarification,
} = vi.hoisted(() => ({
  clarificationFindById: vi.fn(),
  clarificationSoftDelete: vi.fn(),
  contestFindById: vi.fn(),
  examFindById: vi.fn(),
  assessmentFindByIdWithCourseId: vi.fn(),
  courseMembershipFindByComposite: vi.fn(),
  publishClarification: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  clarificationRepo: {
    findById: clarificationFindById,
    softDelete: clarificationSoftDelete,
    create: vi.fn(),
    updateAnswer: vi.fn(),
    updateState: vi.fn(),
    countInWindow: vi.fn(),
    listForContext: vi.fn(),
  },
  contestRepo: { findById: contestFindById },
  examRepo: { findById: examFindById },
  assessmentRepo: { findByIdWithCourseId: assessmentFindByIdWithCourseId },
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

import { deleteClarification } from "../../../packages/domain/src/clarification/mutations";

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
  // Default contest: organizer is usr_organizer.
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

  it("publishes a `deleted` SSE event after a successful soft-delete", async () => {
    clarificationFindById.mockResolvedValue(clarificationRow({ askedByUserId: "usr_asker" }));

    await deleteClarification(actor({ userId: "usr_asker" }), "clr_1");

    expect(publishClarification).toHaveBeenCalledWith(
      "contest",
      "ctst_1",
      expect.objectContaining({ action: "deleted" }),
    );
  });
});
