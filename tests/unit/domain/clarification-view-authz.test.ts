import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  contestFindById,
  examFindById,
  assessmentFindByIdWithCourseId,
  courseMembershipFindByComposite,
  contestListParticipantUserIds,
  examListParticipantUserIds,
  clarificationListForContext,
} = vi.hoisted(() => ({
  contestFindById: vi.fn(),
  examFindById: vi.fn(),
  assessmentFindByIdWithCourseId: vi.fn(),
  courseMembershipFindByComposite: vi.fn(),
  contestListParticipantUserIds: vi.fn(),
  examListParticipantUserIds: vi.fn(),
  clarificationListForContext: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  contestRepo: { findById: contestFindById },
  examRepo: { findById: examFindById },
  assessmentRepo: { findByIdWithCourseId: assessmentFindByIdWithCourseId },
  courseMembershipRepo: { findByComposite: courseMembershipFindByComposite },
  contestParticipationRepo: { listParticipantUserIds: contestListParticipantUserIds },
  examParticipationRepo: { listParticipantUserIds: examListParticipantUserIds },
  clarificationRepo: { listForContext: clarificationListForContext },
}));

import { listForViewer } from "../../../packages/domain/src/clarification/queries";

function actor(
  overrides: Partial<{ userId: string; platformRole: "admin" | "teacher" | "student" }> = {},
) {
  return {
    userId: overrides.userId ?? "usr_actor",
    username: "actor",
    platformRole: overrides.platformRole ?? ("student" as const),
    displayName: "Actor",
    email: "actor@example.com",
  };
}

const contestCtx = (id = "ctst_1") => ({ type: "contest" as const, contestId: id });

const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

const sampleRow = {
  id: "clr_1",
  contextType: "contest",
  contextId: "ctst_1",
  problemId: null,
  questionText: "Is the input 1-indexed?",
  answerText: "Yes.",
  state: "answered",
  askedByUserId: "usr_asker",
  askedBy: { id: "usr_asker", username: "asker", name: "Asker" },
  answeredBy: { id: "usr_organizer", username: "org", name: "Organizer" },
  createdAt: past,
  updatedAt: past,
};

beforeEach(() => {
  vi.clearAllMocks();
  contestFindById.mockResolvedValue({
    id: "ctst_1",
    createdByUserId: "usr_organizer",
    startsAt: past,
    endsAt: future,
  });
  clarificationListForContext.mockResolvedValue([sampleRow]);
});

describe("listForViewer — access gate", () => {
  it("rejects a non-participant, non-staff viewer without reading the board", async () => {
    contestListParticipantUserIds.mockResolvedValue(["usr_other"]);
    await expect(
      listForViewer(actor({ userId: "usr_stranger" }), contestCtx()),
    ).rejects.toThrow(/not permitted/i);
    expect(clarificationListForContext).not.toHaveBeenCalled();
  });

  it("allows a participant and masks the asker identity", async () => {
    contestListParticipantUserIds.mockResolvedValue(["usr_student"]);
    const items = await listForViewer(actor({ userId: "usr_student" }), contestCtx());
    expect(items).toHaveLength(1);
    expect(items[0]?.askedBy).toBeNull();
    expect(items[0]?.askedByUserId).toBeNull();
    expect(items[0]?.questionText).toBe("Is the input 1-indexed?");
  });

  it("allows the organizer (staff) and reveals the asker identity", async () => {
    const items = await listForViewer(actor({ userId: "usr_organizer" }), contestCtx());
    expect(items).toHaveLength(1);
    expect(items[0]?.askedBy).toEqual({ id: "usr_asker", username: "asker", name: "Asker" });
    expect(items[0]?.askedByUserId).toBe("usr_asker");
  });
});
