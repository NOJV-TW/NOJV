import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  examFindById,
  membershipFindByComposite,
  sessionUpdate,
  sessionRecordEvent,
  sessionFindByUserAndExam,
  sessionCreate,
  clearExamPinAndExempt,
  findExamIpPin,
  txExecuteRaw,
  courseLock,
  courseFindById,
} = vi.hoisted(() => ({
  examFindById: vi.fn(),
  membershipFindByComposite: vi.fn(),
  sessionUpdate: vi.fn(),
  sessionRecordEvent: vi.fn(),
  sessionFindByUserAndExam: vi.fn(),
  sessionCreate: vi.fn(),
  clearExamPinAndExempt: vi.fn(),
  findExamIpPin: vi.fn(),
  txExecuteRaw: vi.fn(),
  courseLock: vi.fn(),
  courseFindById: vi.fn(() => Promise.resolve({ id: "crs_1", archived: false })),
}));

vi.mock("@nojv/db", () => ({
  Prisma: {},
  courseRepo: {
    withTx: () => ({
      lockForShare: courseLock,
      lockForUpdate: courseLock,
      findById: courseFindById,
    }),
  },
  examRepo: { withTx: () => ({ findById: examFindById }) },
  courseMembershipRepo: { withTx: () => ({ findByComposite: membershipFindByComposite }) },
  examSessionRepo: {
    withTx: () => ({
      update: sessionUpdate,
      recordEvent: sessionRecordEvent,
      findByUserAndExam: sessionFindByUserAndExam,
      create: sessionCreate,
    }),
  },
  participationRepo: { withTx: () => ({ clearExamPinAndExempt, findExamIpPin }) },
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
    fn({ $executeRaw: txExecuteRaw }),
}));

import { examDomain } from "@nojv/application";

const { releaseSessionAsInstructor, resetStudentIpBinding } = examDomain.session;

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
const adminActor = { ...teacherActor, userId: "usr_admin", platformRole: "admin" as const };

describe("releaseSessionAsInstructor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    examFindById.mockResolvedValue({ id: "exm_1", courseId: "crs_1" });
    sessionFindByUserAndExam.mockResolvedValue({ id: "sess_1", endedAt: null });
    sessionUpdate.mockResolvedValue({ id: "sess_1" });
    sessionRecordEvent.mockResolvedValue({});
  });

  it("allows an effective admin without a course membership", async () => {
    membershipFindByComposite.mockResolvedValue(null);

    await releaseSessionAsInstructor(adminActor, {
      examId: "exm_1",
      targetUserId: "usr_student",
    });

    expect(sessionUpdate).toHaveBeenCalledWith("sess_1", {
      endedAt: expect.any(Date),
      releaseReason: "released_by_instructor",
    });
  });

  it("rejects a non-staff actor", async () => {
    membershipFindByComposite.mockResolvedValue({ role: "student", status: "active" });

    await expect(
      releaseSessionAsInstructor(studentActor, {
        examId: "exm_1",
        targetUserId: "usr_student",
      }),
    ).rejects.toThrow(/staff/i);
    expect(sessionUpdate).not.toHaveBeenCalled();
  });
});

describe("resetStudentIpBinding", () => {
  const now = new Date("2026-05-26T10:00:00Z");

  beforeEach(() => {
    vi.clearAllMocks();
    examFindById.mockResolvedValue({ id: "exm_1", courseId: "crs_1" });
    clearExamPinAndExempt.mockResolvedValue({});
    findExamIpPin.mockResolvedValue({ id: "prt_1", ipPin: "203.0.113.7" });
    sessionFindByUserAndExam.mockResolvedValue({ id: "sess_1" });
    sessionRecordEvent.mockResolvedValue({});
  });

  it("clears the pin and opens a grace window for staff", async () => {
    membershipFindByComposite.mockResolvedValue({ role: "teacher", status: "active" });

    const result = await resetStudentIpBinding(
      teacherActor,
      { examId: "exm_1", targetUserId: "usr_student" },
      now,
    );

    const expected = new Date("2026-05-26T10:10:00Z");
    expect(clearExamPinAndExempt).toHaveBeenCalledWith("exm_1", "usr_student", expected);
    expect(result).toEqual({ exemptUntil: expected });
  });

  it("records an ip_reset audit event against the student's session", async () => {
    membershipFindByComposite.mockResolvedValue({ role: "teacher", status: "active" });

    await resetStudentIpBinding(
      teacherActor,
      { examId: "exm_1", targetUserId: "usr_student" },
      now,
    );

    expect(sessionRecordEvent).toHaveBeenCalledWith({
      sessionId: "sess_1",
      eventType: "ip_reset",
      metadata: {
        resetByUserId: "usr_teacher",
        clearedIpPin: "203.0.113.7",
        exemptUntil: "2026-05-26T10:10:00.000Z",
      },
    });
  });

  it("serializes on the target student's exam-session lock", async () => {
    membershipFindByComposite.mockResolvedValue({ role: "teacher", status: "active" });

    await resetStudentIpBinding(
      teacherActor,
      { examId: "exm_1", targetUserId: "usr_student" },
      now,
    );

    expect(txExecuteRaw).toHaveBeenCalledTimes(1);
    expect(txExecuteRaw.mock.calls[0]?.slice(1)).toEqual(["exam-session:usr_student"]);
  });

  it("audits a reset for a student who never entered on a closed session row", async () => {
    membershipFindByComposite.mockResolvedValue({ role: "teacher", status: "active" });
    findExamIpPin.mockResolvedValue(null);
    sessionFindByUserAndExam.mockResolvedValue(null);
    sessionCreate.mockResolvedValue({ id: "sess_new" });

    await resetStudentIpBinding(
      teacherActor,
      { examId: "exm_1", targetUserId: "usr_student" },
      now,
    );

    expect(clearExamPinAndExempt).toHaveBeenCalledTimes(1);
    expect(sessionCreate).toHaveBeenCalledWith({
      userId: "usr_student",
      examId: "exm_1",
      startedAt: now,
      endedAt: now,
      lastHeartbeatAt: now,
    });
    expect(sessionRecordEvent).toHaveBeenCalledWith({
      sessionId: "sess_new",
      eventType: "ip_reset",
      metadata: {
        resetByUserId: "usr_teacher",
        clearedIpPin: null,
        exemptUntil: "2026-05-26T10:10:00.000Z",
      },
    });
  });

  it("allows a TA", async () => {
    membershipFindByComposite.mockResolvedValue({ role: "ta", status: "active" });

    await resetStudentIpBinding(
      teacherActor,
      { examId: "exm_1", targetUserId: "usr_student" },
      now,
    );

    expect(clearExamPinAndExempt).toHaveBeenCalledTimes(1);
  });

  it("allows an effective admin without a course membership", async () => {
    membershipFindByComposite.mockResolvedValue(null);

    await resetStudentIpBinding(
      adminActor,
      { examId: "exm_1", targetUserId: "usr_student" },
      now,
    );

    expect(clearExamPinAndExempt).toHaveBeenCalledTimes(1);
    expect(sessionRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "ip_reset",
        metadata: expect.objectContaining({ resetByUserId: "usr_admin" }),
      }),
    );
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
    expect(clearExamPinAndExempt).not.toHaveBeenCalled();
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

describe("archived course proctoring", () => {
  const readOnly = { name: "ValidationError", message: "Archived courses are read-only." };

  beforeEach(() => {
    vi.clearAllMocks();
    examFindById.mockResolvedValue({ id: "exm_1", courseId: "crs_1" });
    membershipFindByComposite.mockResolvedValue({ role: "teacher", status: "active" });
    sessionFindByUserAndExam.mockResolvedValue({ id: "s1", endedAt: null });
    courseFindById.mockResolvedValueOnce({ id: "crs_1", archived: true });
  });

  it.each([
    [
      "release one",
      () => releaseSessionAsInstructor(teacherActor, { examId: "exm_1", targetUserId: "u1" }),
    ],
    [
      "reset an IP binding",
      () => resetStudentIpBinding(adminActor, { examId: "exm_1", targetUserId: "u1" }),
    ],
  ])("rejects %s", async (_label, mutate) => {
    await expect(mutate()).rejects.toMatchObject(readOnly);
    expect(courseLock).toHaveBeenCalledWith("crs_1");
    expect(sessionUpdate).not.toHaveBeenCalled();
    expect(sessionRecordEvent).not.toHaveBeenCalled();
    expect(clearExamPinAndExempt).not.toHaveBeenCalled();
  });

  it("checks staff authority before the archive state", async () => {
    membershipFindByComposite.mockResolvedValue({ role: "student", status: "active" });
    await expect(
      releaseSessionAsInstructor(studentActor, { examId: "exm_1", targetUserId: "u1" }),
    ).rejects.toMatchObject({ name: "ForbiddenError" });
  });
});
