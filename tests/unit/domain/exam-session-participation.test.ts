import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression: ExamParticipation must be created when a student starts an exam
// session. Without it the IP gate has no row to pin (IP binding silently never
// enforced) and the scoreboard stays empty. See findings.md [P0].
const {
  examFindById,
  membershipFindByComposite,
  courseFindUnique,
  sessionFindActiveForUser,
  sessionFindByUserAndExam,
  sessionCreate,
  sessionUpdate,
  sessionRecordEvent,
  participationUpsert,
  participationFindByExamAndUser,
} = vi.hoisted(() => ({
  examFindById: vi.fn(),
  membershipFindByComposite: vi.fn(),
  courseFindUnique: vi.fn(),
  sessionFindActiveForUser: vi.fn(),
  sessionFindByUserAndExam: vi.fn(),
  sessionCreate: vi.fn(),
  sessionUpdate: vi.fn(),
  sessionRecordEvent: vi.fn(),
  participationUpsert: vi.fn(),
  participationFindByExamAndUser: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  Prisma: {},
  examRepo: { withTx: () => ({ findById: examFindById }) },
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
  examParticipationRepo: {
    withTx: () => ({
      upsert: participationUpsert,
      findByExamAndUser: participationFindByExamAndUser,
    }),
  },
  examParticipationIpRepo: { withTx: () => ({}) },
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

describe("startSession — ExamParticipation creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    examFindById.mockResolvedValue({ id: "exm_1", courseId: "crs_1" });
    membershipFindByComposite.mockResolvedValue({ role: "student", status: "active" });
    courseFindUnique.mockResolvedValue({ archived: false });
    sessionFindActiveForUser.mockResolvedValue(null);
    sessionRecordEvent.mockResolvedValue({});
    // Default: no prior participation row (fresh entry).
    participationFindByExamAndUser.mockResolvedValue(null);
  });

  it("upserts an ExamParticipation row on a fresh session start", async () => {
    sessionFindByUserAndExam.mockResolvedValue(null);
    sessionCreate.mockResolvedValue({ id: "ses_1", examId: "exm_1", userId: "usr_student" });

    await startSession(studentActor, { examId: "exm_1" });

    expect(participationUpsert).toHaveBeenCalledTimes(1);
    const [examId, userId] = participationUpsert.mock.calls[0];
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

    expect(participationUpsert).toHaveBeenCalledTimes(1);
  });

  it("does NOT revive a disqualified participation on re-entry", async () => {
    participationFindByExamAndUser.mockResolvedValue({
      id: "ep_1",
      status: "disqualified",
    });
    sessionFindByUserAndExam.mockResolvedValue(null);
    sessionCreate.mockResolvedValue({ id: "ses_1", examId: "exm_1", userId: "usr_student" });

    await startSession(studentActor, { examId: "exm_1" });

    // Upsert update payload must not flip status back to "active".
    expect(participationUpsert).toHaveBeenCalledTimes(1);
    const updateData = participationUpsert.mock.calls[0][3];
    expect(updateData.status).toBeUndefined();
  });

  it("activates a previously-registered participation on entry", async () => {
    participationFindByExamAndUser.mockResolvedValue({ id: "ep_1", status: "registered" });
    sessionFindByUserAndExam.mockResolvedValue(null);
    sessionCreate.mockResolvedValue({ id: "ses_1", examId: "exm_1", userId: "usr_student" });

    await startSession(studentActor, { examId: "exm_1" });

    const updateData = participationUpsert.mock.calls[0][3];
    expect(updateData.status).toBe("active");
  });
});
