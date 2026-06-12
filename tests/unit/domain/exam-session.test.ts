import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared repo stubs — hoisted so the `vi.mock` factory below can
// reference them. `vi.mock` is hoisted above regular imports.
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
}));

vi.mock("@nojv/db", () => {
  return {
    examRepo: {
      withTx: () => ({ findById: examFindById }),
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
      }),
    },
    runTransaction: async <T>(
      fn: (tx: { $executeRaw: (...args: unknown[]) => Promise<number> }) => Promise<T>,
    ): Promise<T> => fn({ $executeRaw: async () => 0 }),
  };
});

import { examDomain, ForbiddenError, NotFoundError } from "@nojv/domain";

const { session } = examDomain;

const fakeExam = {
  id: "exam_midterm",
  courseId: "course_os_lab",
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

  it("re-opens an ended session by clearing endedAt and records a fresh enter event", async () => {
    setupEnrolledStudent();
    sessionFindByUserAndExam.mockResolvedValue({
      id: "sess_old",
      userId: fakeActor.userId,
      examId: fakeExam.id,
      endedAt: new Date("2026-04-13T10:00:00.000Z"),
      releaseReason: "submitted",
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
    expect(sessionRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess_1",
        eventType: "release",
        metadata: { reason: "submitted" },
      }),
    );
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
    });
    examFindByIdOrThrow.mockResolvedValue(fakeExam);

    const result = await session.getActiveSessionContext(fakeActor.userId);

    expect(result).not.toBeNull();
    expect(result!.session.id).toBe("sess_1");
    expect(result!.session.examId).toBe(fakeExam.id);
    expect(result!.exam).toEqual({
      id: fakeExam.id,
      courseId: fakeExam.courseId,
      title: fakeExam.title,
    });
    expect(result!.course).toEqual({ id: fakeExam.courseId });
  });
});
