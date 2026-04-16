import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  examFindById,
  contestFindById,
  membershipFindByComposite,
  txCourseFindUnique,
  txExamParticipationFindUnique,
  checkIpLockMock
} = vi.hoisted(() => ({
  examFindById: vi.fn(),
  contestFindById: vi.fn(),
  membershipFindByComposite: vi.fn(),
  txCourseFindUnique: vi.fn(),
  txExamParticipationFindUnique: vi.fn(),
  checkIpLockMock: vi.fn()
}));

vi.mock("@nojv/db", () => ({
  examRepo: {
    withTx: () => ({ findById: examFindById })
  },
  contestRepo: {
    withTx: () => ({ findById: contestFindById })
  },
  courseMembershipRepo: {
    withTx: () => ({ findByComposite: membershipFindByComposite })
  },
  runTransaction: async <T>(
    fn: (tx: {
      course: { findUnique: typeof txCourseFindUnique };
      examParticipation: { findUnique: typeof txExamParticipationFindUnique };
    }) => Promise<T>
  ): Promise<T> =>
    fn({
      course: { findUnique: txCourseFindUnique },
      examParticipation: { findUnique: txExamParticipationFindUnique }
    })
}));

vi.mock("../../../packages/domain/src/shared/ip-utils", () => ({
  checkIpLock: checkIpLockMock
}));

const { checkProctoringGate } = await import("../../../packages/domain/src/proctoring/gate");

const now = new Date("2026-05-01T10:00:00.000Z");
const examStart = new Date("2026-05-01T09:00:00.000Z");
const examEnd = new Date("2026-05-01T12:00:00.000Z");

const baseExam = {
  id: "exam_midterm",
  courseId: "course_os",
  status: "published" as const,
  startsAt: examStart,
  endsAt: examEnd,
  pageLockEnabled: false,
  ipBindingEnabled: false,
  ipWhitelistEnabled: false,
  ipWhitelist: [] as string[],
  ipViolationMode: "block"
};

const baseContest = {
  id: "spring-qualifier-2026",
  visibility: "published" as const,
  startsAt: examStart,
  endsAt: examEnd,
  pageLockEnabled: false,
  ipBindingEnabled: false,
  ipWhitelistEnabled: false,
  ipWhitelist: [] as string[],
  ipViolationMode: "block"
};

beforeEach(() => {
  vi.clearAllMocks();
  checkIpLockMock.mockResolvedValue({ allowed: true });
  txExamParticipationFindUnique.mockResolvedValue(null);
});

describe("checkProctoringGate — exam", () => {
  it("returns ok when membership active, course not archived, within window", async () => {
    examFindById.mockResolvedValue(baseExam);
    membershipFindByComposite.mockResolvedValue({ status: "active" });
    txCourseFindUnique.mockResolvedValue({ archived: false });

    const verdict = await checkProctoringGate({
      entityKind: "exam",
      entityId: baseExam.id,
      userId: "usr_student",
      now
    });

    expect(verdict).toEqual({ ok: true });
  });

  it("denies with ip_binding when IP check fails", async () => {
    examFindById.mockResolvedValue({ ...baseExam, ipBindingEnabled: true });
    membershipFindByComposite.mockResolvedValue({ status: "active" });
    txCourseFindUnique.mockResolvedValue({ archived: false });
    checkIpLockMock.mockResolvedValue({ allowed: false, violationType: "binding" });

    const verdict = await checkProctoringGate({
      entityKind: "exam",
      entityId: baseExam.id,
      userId: "usr_student",
      ip: "10.0.0.1",
      now
    });

    expect(verdict).toEqual({ ok: false, reason: "ip_binding" });
  });

  it("denies with not_enrolled when membership missing", async () => {
    examFindById.mockResolvedValue(baseExam);
    membershipFindByComposite.mockResolvedValue(null);
    txCourseFindUnique.mockResolvedValue({ archived: false });

    const verdict = await checkProctoringGate({
      entityKind: "exam",
      entityId: baseExam.id,
      userId: "usr_student",
      now
    });

    expect(verdict).toEqual({ ok: false, reason: "not_enrolled" });
  });

  it("denies with not_started before startsAt", async () => {
    examFindById.mockResolvedValue(baseExam);
    membershipFindByComposite.mockResolvedValue({ status: "active" });
    txCourseFindUnique.mockResolvedValue({ archived: false });

    const verdict = await checkProctoringGate({
      entityKind: "exam",
      entityId: baseExam.id,
      userId: "usr_student",
      now: new Date("2026-05-01T08:30:00.000Z")
    });

    expect(verdict).toEqual({ ok: false, reason: "not_started" });
  });
});

describe("checkProctoringGate — contest", () => {
  it("returns ok when published and within window (no enrollment check)", async () => {
    contestFindById.mockResolvedValue(baseContest);

    const verdict = await checkProctoringGate({
      entityKind: "contest",
      entityId: baseContest.id,
      userId: "usr_student",
      now
    });

    expect(verdict).toEqual({ ok: true });
    expect(membershipFindByComposite).not.toHaveBeenCalled();
  });

  it("denies with ip_whitelist when IP check rejects via whitelist", async () => {
    contestFindById.mockResolvedValue({
      ...baseContest,
      ipWhitelistEnabled: true,
      ipWhitelist: ["192.168.1.0/24"]
    });
    checkIpLockMock.mockResolvedValue({ allowed: false, violationType: "whitelist" });

    const verdict = await checkProctoringGate({
      entityKind: "contest",
      entityId: baseContest.id,
      userId: "usr_student",
      ip: "10.0.0.1",
      now
    });

    expect(verdict).toEqual({ ok: false, reason: "ip_whitelist" });
  });

  it("denies with not_found when contest missing", async () => {
    contestFindById.mockResolvedValue(null);

    const verdict = await checkProctoringGate({
      entityKind: "contest",
      entityId: "missing",
      userId: "usr_student",
      now
    });

    expect(verdict).toEqual({ ok: false, reason: "not_found" });
  });

  it("denies with ended when after endsAt", async () => {
    contestFindById.mockResolvedValue(baseContest);

    const verdict = await checkProctoringGate({
      entityKind: "contest",
      entityId: baseContest.id,
      userId: "usr_student",
      now: new Date("2026-05-01T13:00:00.000Z")
    });

    expect(verdict).toEqual({ ok: false, reason: "ended" });
  });
});
