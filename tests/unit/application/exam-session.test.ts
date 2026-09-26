import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  examFindById,
  examFindByIdOrThrow,
  sessionFindByUserAndExam,
  sessionFindActiveForUser,
  sessionCreate,
  sessionUpdate,
  sessionRecordEvent,
  membershipFindByComposite,
  txCourseFindUnique,
  participationUpsertExamActive,
  participationFindExamParticipation,
  participationMarkExamSubmitted,
  participationBindExamIpPinIfUnset,
  gateInTx,
} = vi.hoisted(() => ({
  examFindById: vi.fn(),
  examFindByIdOrThrow: vi.fn(),
  sessionFindByUserAndExam: vi.fn(),
  sessionFindActiveForUser: vi.fn(),
  sessionCreate: vi.fn(),
  sessionUpdate: vi.fn(),
  sessionRecordEvent: vi.fn(),
  membershipFindByComposite: vi.fn(),
  txCourseFindUnique: vi.fn(),
  participationUpsertExamActive: vi.fn(),
  participationFindExamParticipation: vi.fn(),
  participationMarkExamSubmitted: vi.fn(),
  participationBindExamIpPinIfUnset: vi.fn(),
  gateInTx: vi.fn(),
}));

vi.mock("@nojv/db", () => {
  return {
    examRepo: {
      withTx: () => ({ findById: examFindById }),
      findById: examFindById,
      findByIdOrThrow: examFindByIdOrThrow,
    },
    examSessionRepo: {
      findActiveForUser: sessionFindActiveForUser,
      withTx: () => ({
        findActiveForUser: sessionFindActiveForUser,
        findByUserAndExam: sessionFindByUserAndExam,
        create: sessionCreate,
        update: sessionUpdate,
        recordEvent: sessionRecordEvent,
      }),
    },
    courseRepo: {
      withTx: () => ({ findArchivedById: txCourseFindUnique }),
    },
    courseMembershipRepo: {
      withTx: () => ({ findByComposite: membershipFindByComposite }),
    },
    participationRepo: {
      withTx: () => ({
        upsertExamActive: participationUpsertExamActive,
        findExamParticipation: participationFindExamParticipation,
        markExamSubmitted: participationMarkExamSubmitted,
        bindExamIpPinIfUnset: participationBindExamIpPinIfUnset,
      }),
    },
    runTransaction: async <T>(
      fn: (tx: { $executeRaw: (...args: unknown[]) => Promise<number> }) => Promise<T>,
    ): Promise<T> => fn({ $executeRaw: async () => 0 }),
  };
});

vi.mock("../../../packages/application/src/proctoring/gate", () => ({
  checkProctoringGateInTx: gateInTx,
}));

import {
  ConflictError,
  examDomain,
  ForbiddenError,
  HttpError,
  NotFoundError,
} from "@nojv/application";

const { session } = examDomain;

const fakeExam = {
  id: "exam_midterm",
  courseId: "course_os_lab",
  pageLockEnabled: true,
  title: "Midterm",
};

const fakeActor = {
  userId: "usr_student",
  username: "student",
  displayName: "Student One",
  email: "student@example.com",
  platformRole: "student" as const,
};

function setupEnrolledStudent({ archived = false }: { archived?: boolean } = {}) {
  examFindById.mockResolvedValue(fakeExam);
  participationFindExamParticipation.mockResolvedValue(null);
  membershipFindByComposite.mockResolvedValue({
    courseId: fakeExam.courseId,
    userId: fakeActor.userId,
    status: "active",
    role: "student",
  });
  txCourseFindUnique.mockResolvedValue({ archived });
}

describe("examDomain.session.startSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a new session and records an enter event when none exists", async () => {
    setupEnrolledStudent();
    sessionFindByUserAndExam.mockResolvedValue(null);
    sessionCreate.mockResolvedValue({
      id: "sess_1",
      userId: fakeActor.userId,
      examId: fakeExam.id,
      endedAt: null,
    });

    const result = await session.startSession(fakeActor, {
      examId: fakeExam.id,
    });

    expect(result.id).toBe("sess_1");
    expect(sessionCreate).toHaveBeenCalledTimes(1);
    expect(sessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: fakeActor.userId,
        examId: fakeExam.id,
      }),
    );
    expect(sessionRecordEvent).toHaveBeenCalledTimes(1);
    expect(sessionRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "sess_1", eventType: "enter" }),
    );
  });

  it("is idempotent — returns the existing unended session without recording a new enter event", async () => {
    setupEnrolledStudent();
    const existing = {
      id: "sess_existing",
      userId: fakeActor.userId,
      examId: fakeExam.id,
      endedAt: null,
    };
    sessionFindByUserAndExam.mockResolvedValue(existing);

    const result = await session.startSession(fakeActor, { examId: fakeExam.id });

    expect(result).toEqual(existing);
    expect(sessionCreate).not.toHaveBeenCalled();
    expect(sessionUpdate).not.toHaveBeenCalled();
    expect(sessionRecordEvent).not.toHaveBeenCalled();
  });

  it("re-opens an instructor-released session and records a fresh enter event", async () => {
    setupEnrolledStudent();
    sessionFindByUserAndExam.mockResolvedValue({
      id: "sess_old",
      userId: fakeActor.userId,
      examId: fakeExam.id,
      endedAt: new Date("2026-04-13T10:00:00.000Z"),
      releaseReason: "released_by_instructor",
    });
    sessionUpdate.mockResolvedValue({
      id: "sess_old",
      userId: fakeActor.userId,
      examId: fakeExam.id,
      endedAt: null,
    });

    await session.startSession(fakeActor, { examId: fakeExam.id });

    expect(sessionUpdate).toHaveBeenCalledWith(
      "sess_old",
      expect.objectContaining({
        endedAt: null,
        releaseReason: null,
      }),
    );
    expect(sessionRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "sess_old", eventType: "enter" }),
    );
  });

  it.each(["session", "participation"])(
    "rejects re-entry after submitted %s without changing any state",
    async (source) => {
      setupEnrolledStudent();
      sessionFindActiveForUser.mockResolvedValue(null);
      sessionFindByUserAndExam.mockResolvedValue({
        id: "sess_submitted",
        endedAt: new Date(),
        releaseReason: source === "session" ? "submitted" : "released_by_instructor",
      });
      participationFindExamParticipation.mockResolvedValue({
        status: source === "participation" ? "submitted" : "active",
      });

      await expect(session.startSession(fakeActor, { examId: fakeExam.id })).rejects.toThrow(
        "You have already submitted this exam.",
      );
      expect(sessionUpdate).not.toHaveBeenCalled();
      expect(participationUpsertExamActive).not.toHaveBeenCalled();
      expect(sessionRecordEvent).not.toHaveBeenCalled();
    },
  );

  it("throws ForbiddenError when actor is not enrolled in the exam's course", async () => {
    examFindById.mockResolvedValue(fakeExam);
    membershipFindByComposite.mockResolvedValue(null);

    await expect(
      session.startSession(fakeActor, { examId: fakeExam.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(sessionCreate).not.toHaveBeenCalled();
    expect(sessionRecordEvent).not.toHaveBeenCalled();
  });

  it("throws ForbiddenError when membership exists but is not active", async () => {
    examFindById.mockResolvedValue(fakeExam);
    membershipFindByComposite.mockResolvedValue({
      courseId: fakeExam.courseId,
      userId: fakeActor.userId,
      status: "removed",
      role: "student",
    });

    await expect(
      session.startSession(fakeActor, { examId: fakeExam.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws NotFoundError when exam does not exist", async () => {
    examFindById.mockResolvedValue(null);

    await expect(
      session.startSession(fakeActor, { examId: "exam_ghost" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("examDomain.session.startSessionWithGate", () => {
  const now = new Date("2026-05-01T10:00:00.000Z");
  const gatedExam = {
    ...fakeExam,
    status: "published" as const,
    startsAt: new Date("2026-05-01T09:00:00.000Z"),
    endsAt: new Date("2026-05-01T12:00:00.000Z"),
    ipBindingEnabled: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setupEnrolledStudent();
    examFindById.mockResolvedValue(gatedExam);
    sessionFindActiveForUser.mockResolvedValue(null);
    sessionFindByUserAndExam.mockResolvedValue(null);
    participationUpsertExamActive.mockResolvedValue({ id: "part_1" });
    participationBindExamIpPinIfUnset.mockResolvedValue(true);
    sessionCreate.mockResolvedValue({
      id: "sess_1",
      userId: fakeActor.userId,
      examId: gatedExam.id,
      startedAt: now,
      endedAt: null,
    });
    gateInTx.mockResolvedValue({ ok: true });
  });

  it.each([
    ["ip_binding", ForbiddenError, /IP restrictions/],
    ["ip_whitelist", ForbiddenError, /IP restrictions/],
    ["not_started", HttpError, /not started/],
    ["course_archived", ForbiddenError, /archived/],
  ] as const)(
    "rejects a %s denial before creating the session",
    async (reason, errorClass, message) => {
      gateInTx.mockResolvedValue({ ok: false, reason });

      const attempt = session.startSessionWithGate(fakeActor, {
        examId: gatedExam.id,
        ip: "198.51.100.20",
        now,
      });

      await expect(attempt).rejects.toBeInstanceOf(errorClass);
      await expect(attempt).rejects.toThrow(message);
      expect(gateInTx).toHaveBeenCalledWith(expect.anything(), {
        entityKind: "exam",
        entityId: gatedExam.id,
        userId: fakeActor.userId,
        ip: "198.51.100.20",
        now,
        startGraceMs: session.START_GRACE_MS,
      });
      expect(participationUpsertExamActive).not.toHaveBeenCalled();
      expect(sessionCreate).not.toHaveBeenCalled();
      expect(sessionUpdate).not.toHaveBeenCalled();
      expect(sessionRecordEvent).not.toHaveBeenCalled();
    },
  );

  it("pins the first entry IP atomically before creating the session", async () => {
    const result = await session.startSessionWithGate(fakeActor, {
      examId: gatedExam.id,
      ip: "203.0.113.7",
      now,
    });

    expect(result.created).toBe(true);
    expect(participationBindExamIpPinIfUnset).toHaveBeenCalledWith("part_1", "203.0.113.7");
    const [gateOrder] = gateInTx.mock.invocationCallOrder;
    const [upsertOrder] = participationUpsertExamActive.mock.invocationCallOrder;
    const [bindOrder] = participationBindExamIpPinIfUnset.mock.invocationCallOrder;
    const [createOrder] = sessionCreate.mock.invocationCallOrder;
    expect(gateOrder).toBeLessThan(upsertOrder ?? 0);
    expect(bindOrder).toBeLessThan(createOrder ?? 0);
  });

  it("leaves the pin to the gate when the participation already exists", async () => {
    participationFindExamParticipation.mockResolvedValue({ status: "registered" });

    await session.startSessionWithGate(fakeActor, {
      examId: gatedExam.id,
      ip: "203.0.113.7",
      now,
    });

    expect(participationBindExamIpPinIfUnset).not.toHaveBeenCalled();
    expect(sessionCreate).toHaveBeenCalledTimes(1);
  });

  it("aborts entry without a session when the first pin is lost", async () => {
    participationBindExamIpPinIfUnset.mockResolvedValue(false);

    await expect(
      session.startSessionWithGate(fakeActor, {
        examId: gatedExam.id,
        ip: "203.0.113.7",
        now,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(sessionCreate).not.toHaveBeenCalled();
    expect(sessionRecordEvent).not.toHaveBeenCalled();
  });
});

describe("examDomain.session.endSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks the session ended and records a release event with the reason", async () => {
    setupEnrolledStudent();
    sessionFindByUserAndExam.mockResolvedValue({
      id: "sess_1",
      userId: fakeActor.userId,
      examId: fakeExam.id,
      endedAt: null,
    });
    sessionUpdate.mockImplementation(async (id: string, data: unknown) => ({
      id,
      ...(data as object),
    }));

    await session.endSession(fakeActor, { examId: fakeExam.id, reason: "submitted" });

    expect(sessionUpdate).toHaveBeenCalledTimes(1);
    const [, updateData] = sessionUpdate.mock.calls[0] as [string, Record<string, unknown>];
    expect(updateData.endedAt).toBeInstanceOf(Date);
    expect(updateData.releaseReason).toBe("submitted");
    expect(participationMarkExamSubmitted).toHaveBeenCalledWith(
      fakeExam.id,
      fakeActor.userId,
      updateData.endedAt,
    );
    expect(sessionRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess_1",
        eventType: "release",
        metadata: { reason: "submitted" },
      }),
    );
  });

  it("keeps an ended session unchanged when hand-in is retried", async () => {
    setupEnrolledStudent();
    const ended = { id: "sess_1", endedAt: new Date(), releaseReason: "submitted" };
    sessionFindByUserAndExam.mockResolvedValue(ended);

    expect(
      await session.endSession(fakeActor, { examId: fakeExam.id, reason: "submitted" }),
    ).toEqual(ended);
    expect(sessionUpdate).not.toHaveBeenCalled();
    expect(participationMarkExamSubmitted).not.toHaveBeenCalled();
    expect(sessionRecordEvent).not.toHaveBeenCalled();
  });

  it("treats a closed session that only holds reset audit rows as no session", async () => {
    setupEnrolledStudent();
    sessionFindByUserAndExam.mockResolvedValue({
      id: "sess_reset",
      endedAt: new Date(),
      releaseReason: null,
    });

    await expect(
      session.endSession(fakeActor, { examId: fakeExam.id, reason: "submitted" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(participationMarkExamSubmitted).not.toHaveBeenCalled();
    expect(sessionUpdate).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when no session exists for the actor", async () => {
    setupEnrolledStudent();
    sessionFindByUserAndExam.mockResolvedValue(null);

    await expect(
      session.endSession(fakeActor, { examId: fakeExam.id, reason: "time_up" }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(sessionUpdate).not.toHaveBeenCalled();
  });
});

describe("examDomain.session.recordEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appends an event without touching session row state", async () => {
    setupEnrolledStudent();
    sessionFindByUserAndExam.mockResolvedValue({
      id: "sess_1",
      userId: fakeActor.userId,
      examId: fakeExam.id,
      endedAt: null,
    });

    await session.recordEvent(fakeActor, {
      examId: fakeExam.id,
      eventType: "visibility_lost",
      metadata: { durationMs: 3200 },
    });

    expect(sessionUpdate).not.toHaveBeenCalled();
    expect(sessionRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess_1",
        eventType: "visibility_lost",
        metadata: { durationMs: 3200 },
      }),
    );
  });

  it("omits metadata when not provided", async () => {
    setupEnrolledStudent();
    sessionFindByUserAndExam.mockResolvedValue({
      id: "sess_1",
      userId: fakeActor.userId,
      examId: fakeExam.id,
      endedAt: null,
    });

    await session.recordEvent(fakeActor, {
      examId: fakeExam.id,
      eventType: "leave",
    });

    const call = sessionRecordEvent.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.sessionId).toBe("sess_1");
    expect(call.eventType).toBe("leave");
    expect(call).not.toHaveProperty("metadata");
  });
});

describe("examDomain.session.getActiveSessionContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no active session exists", async () => {
    sessionFindActiveForUser.mockResolvedValue(null);

    const result = await session.getActiveSessionContext(fakeActor.userId);
    expect(result).toBeNull();
    expect(examFindByIdOrThrow).not.toHaveBeenCalled();
  });

  it("returns session + exam + course context when an active session exists", async () => {
    sessionFindActiveForUser.mockResolvedValue({
      id: "sess_1",
      userId: fakeActor.userId,
      examId: fakeExam.id,
      startedAt: new Date("2026-04-14T09:00:00.000Z"),
      endedAt: null,
      exam: fakeExam,
    });

    const result = await session.getActiveSessionContext(fakeActor.userId);

    expect(result).not.toBeNull();
    expect(result!.session.id).toBe("sess_1");
    expect(result!.session.examId).toBe(fakeExam.id);
    expect(result!.exam).toEqual({
      id: fakeExam.id,
      courseId: fakeExam.courseId,
      pageLockEnabled: fakeExam.pageLockEnabled,
      title: fakeExam.title,
    });
    expect(result!.course).toEqual({ id: fakeExam.courseId });
  });
});
