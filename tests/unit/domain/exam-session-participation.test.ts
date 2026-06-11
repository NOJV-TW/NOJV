import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  examFindById,
  membershipFindByComposite,
  courseFindUnique,
  sessionFindActiveForUser,
  sessionFindByUserAndExam,
  sessionCreate,
  sessionUpdate,
  sessionRecordEvent,
  participationUpsertExamActive,
  participationFindExamParticipation,
} = vi.hoisted(() => ({
  examFindById: vi.fn(),
  membershipFindByComposite: vi.fn(),
  courseFindUnique: vi.fn(),
  sessionFindActiveForUser: vi.fn(),
  sessionFindByUserAndExam: vi.fn(),
  sessionCreate: vi.fn(),
  sessionUpdate: vi.fn(),
  sessionRecordEvent: vi.fn(),
  participationUpsertExamActive: vi.fn(),
  participationFindExamParticipation: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  Prisma: {},
  examRepo: { withTx: () => ({ findById: examFindById }) },
  courseRepo: { withTx: () => ({ findArchivedById: courseFindUnique }) },
  courseMembershipRepo: { withTx: () => ({ findByComposite: membershipFindByComposite }) },
  examSessionRepo: {
    withTx: () => ({
      findActiveForUser: sessionFindActiveForUser,
      findByUserAndExam: sessionFindByUserAndExam,
      create: sessionCreate,
      update: sessionUpdate,
      recordEvent: sessionRecordEvent,
    }),
  },
  participationRepo: {
    withTx: () => ({
      upsertExamActive: participationUpsertExamActive,
      findExamParticipation: participationFindExamParticipation,
    }),
  },
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
    fn({
      $executeRaw: async () => undefined,
      course: { findUnique: courseFindUnique },
    }),
}));

import { examDomain } from "@nojv/domain";

const { startSession } = examDomain.session;

const studentActor = {
  userId: "usr_student",
  username: "student",
  displayName: "Student",
  email: "s@example.com",
  platformRole: "student" as const,
};

describe("startSession — Participation creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    examFindById.mockResolvedValue({ id: "exm_1", courseId: "crs_1" });
    membershipFindByComposite.mockResolvedValue({ role: "student", status: "active" });
    courseFindUnique.mockResolvedValue({ archived: false });
    sessionFindActiveForUser.mockResolvedValue(null);
    sessionRecordEvent.mockResolvedValue({});
    participationFindExamParticipation.mockResolvedValue(null);
  });

  it("upserts a Participation row on a fresh session start", async () => {
    sessionFindByUserAndExam.mockResolvedValue(null);
    sessionCreate.mockResolvedValue({ id: "ses_1", examId: "exm_1", userId: "usr_student" });

    await startSession(studentActor, { examId: "exm_1" });

    expect(participationUpsertExamActive).toHaveBeenCalledTimes(1);
    const [examId, userId] = participationUpsertExamActive.mock.calls[0];
    expect(examId).toBe("exm_1");
    expect(userId).toBe("usr_student");
  });

  it("ensures participation even when re-entering an already-active session", async () => {
    sessionFindByUserAndExam.mockResolvedValue({
      id: "ses_1",
      examId: "exm_1",
      userId: "usr_student",
      endedAt: null,
    });

    await startSession(studentActor, { examId: "exm_1" });

    expect(participationUpsertExamActive).toHaveBeenCalledTimes(1);
  });

  it("does NOT revive a disqualified participation on re-entry", async () => {
    participationFindExamParticipation.mockResolvedValue({
      id: "ep_1",
      status: "disqualified",
    });
    sessionFindByUserAndExam.mockResolvedValue(null);
    sessionCreate.mockResolvedValue({ id: "ses_1", examId: "exm_1", userId: "usr_student" });

    await startSession(studentActor, { examId: "exm_1" });

    expect(participationUpsertExamActive).toHaveBeenCalledTimes(1);
    const activateOnEntry = participationUpsertExamActive.mock.calls[0][2];
    expect(activateOnEntry).toBe(false);
  });

  it("activates a previously-registered participation on entry", async () => {
    participationFindExamParticipation.mockResolvedValue({ id: "ep_1", status: "registered" });
    sessionFindByUserAndExam.mockResolvedValue(null);
    sessionCreate.mockResolvedValue({ id: "ses_1", examId: "exm_1", userId: "usr_student" });

    await startSession(studentActor, { examId: "exm_1" });

    const activateOnEntry = participationUpsertExamActive.mock.calls[0][2];
    expect(activateOnEntry).toBe(true);
  });
});
