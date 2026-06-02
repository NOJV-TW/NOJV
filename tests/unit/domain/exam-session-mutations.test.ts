import { beforeEach, describe, expect, it, vi } from "vitest";

// Repo stubs — hoisted so the vi.mock factory can reference them.
const {
  examFindById,
  membershipFindByComposite,
  sessionFindAllActive,
  sessionUpdate,
  sessionRecordEvent,
  clearPinAndExempt,
} = vi.hoisted(() => ({
  examFindById: vi.fn(),
  membershipFindByComposite: vi.fn(),
  sessionFindAllActive: vi.fn(),
  sessionUpdate: vi.fn(),
  sessionRecordEvent: vi.fn(),
  clearPinAndExempt: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  Prisma: {},
  examRepo: { withTx: () => ({ findById: examFindById }) },
  courseMembershipRepo: { withTx: () => ({ findByComposite: membershipFindByComposite }) },
  examSessionRepo: {
    withTx: () => ({
      findAllActiveForExam: sessionFindAllActive,
      update: sessionUpdate,
      recordEvent: sessionRecordEvent,
    }),
  },
  examParticipationIpRepo: { withTx: () => ({ clearPinAndExempt }) },
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}),
}));

import { examDomain } from "@nojv/domain";

const { releaseAllSessionsAsInstructor, resetStudentIpBinding } = examDomain.session;

const teacherActor = {
  userId: "usr_teacher",
  username: "teacher",
  displayName: "Teacher",
  email: "t@example.com",
  platformRole: "teacher" as const,
};
const studentActor = {
  userId: "usr_student",
  username: "student",
  displayName: "Student",
  email: "s@example.com",
  platformRole: "student" as const,
};

describe("releaseAllSessionsAsInstructor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    examFindById.mockResolvedValue({ id: "exm_1", courseId: "crs_1" });
    sessionUpdate.mockResolvedValue({});
    sessionRecordEvent.mockResolvedValue({});
  });

  it("releases every active session and returns the count", async () => {
    membershipFindByComposite.mockResolvedValue({ role: "teacher", status: "active" });
    sessionFindAllActive.mockResolvedValue([{ id: "s1" }, { id: "s2" }, { id: "s3" }]);

    const result = await releaseAllSessionsAsInstructor(teacherActor, { examId: "exm_1" });

    expect(result).toEqual({ released: 3 });
    expect(sessionUpdate).toHaveBeenCalledTimes(3);
    expect(sessionRecordEvent).toHaveBeenCalledTimes(3);
    expect(sessionUpdate).toHaveBeenCalledWith("s1", {
      endedAt: expect.any(Date),
      releaseReason: "released_by_instructor",
    });
  });

  it("allows a TA and is a no-op when no sessions are active", async () => {
    membershipFindByComposite.mockResolvedValue({ role: "ta", status: "active" });
    sessionFindAllActive.mockResolvedValue([]);

    const result = await releaseAllSessionsAsInstructor(teacherActor, { examId: "exm_1" });

    expect(result).toEqual({ released: 0 });
    expect(sessionUpdate).not.toHaveBeenCalled();
  });

  it("rejects a non-staff actor", async () => {
    membershipFindByComposite.mockResolvedValue({ role: "student", status: "active" });

    await expect(
      releaseAllSessionsAsInstructor(studentActor, { examId: "exm_1" }),
    ).rejects.toThrow(/staff/i);
    expect(sessionUpdate).not.toHaveBeenCalled();
  });

  it("throws when the exam does not exist", async () => {
    examFindById.mockResolvedValue(null);

    await expect(
      releaseAllSessionsAsInstructor(teacherActor, { examId: "missing" }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("resetStudentIpBinding", () => {
  const now = new Date("2026-05-26T10:00:00Z");

  beforeEach(() => {
    vi.clearAllMocks();
    examFindById.mockResolvedValue({ id: "exm_1", courseId: "crs_1" });
    clearPinAndExempt.mockResolvedValue({});
  });

  it("clears the pin and opens a grace window for staff", async () => {
    membershipFindByComposite.mockResolvedValue({ role: "teacher", status: "active" });

    const result = await resetStudentIpBinding(
      teacherActor,
      { examId: "exm_1", targetUserId: "usr_student" },
      now,
    );

    // 10-minute grace window.
    const expected = new Date("2026-05-26T10:10:00Z");
    expect(clearPinAndExempt).toHaveBeenCalledWith("exm_1", "usr_student", expected);
    expect(result).toEqual({ exemptUntil: expected });
  });

  it("allows a TA", async () => {
    membershipFindByComposite.mockResolvedValue({ role: "ta", status: "active" });

    await resetStudentIpBinding(
      teacherActor,
      { examId: "exm_1", targetUserId: "usr_student" },
      now,
    );

    expect(clearPinAndExempt).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-staff actor", async () => {
    membershipFindByComposite.mockResolvedValue({ role: "student", status: "active" });

    await expect(
      resetStudentIpBinding(
        studentActor,
        { examId: "exm_1", targetUserId: "usr_student" },
        now,
      ),
    ).rejects.toThrow(/staff/i);
    expect(clearPinAndExempt).not.toHaveBeenCalled();
  });

  it("throws when the exam does not exist", async () => {
    examFindById.mockResolvedValue(null);

    await expect(
      resetStudentIpBinding(
        teacherActor,
        { examId: "missing", targetUserId: "usr_student" },
        now,
      ),
    ).rejects.toThrow(/not found/i);
  });
});
