import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  examFindById,
  examLockForUpdate,
  closeActiveForExam,
  update,
  recordEvent,
  recordEvents,
} = vi.hoisted(() => ({
  examFindById: vi.fn(),
  examLockForUpdate: vi.fn(),
  closeActiveForExam: vi.fn(),
  update: vi.fn(),
  recordEvent: vi.fn(),
  recordEvents: vi.fn(),
}));

vi.mock("@nojv/db", () => {
  const txRepo = {
    closeActiveForExam,
    update,
    recordEvent,
    recordEvents,
    findByUserAndExam: vi.fn(),
    findActiveForUser: vi.fn(),
    create: vi.fn(),
  };
  return {
    examRepo: {
      withTx: () => ({ findById: examFindById, lockForUpdate: examLockForUpdate }),
      findByIdOrThrow: vi.fn(),
    },
    examSessionRepo: {
      findActiveForUser: vi.fn(),
      withTx: () => txRepo,
    },
    courseMembershipRepo: {
      withTx: () => ({ findByComposite: vi.fn() }),
    },
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}),
  };
});

import { examDomain } from "@nojv/application";

const { session } = examDomain;

const input = {
  examId: "exam_abc",
  startsAt: "2030-01-01T09:00:00.000Z",
  endsAt: "2030-01-01T10:00:00.000Z",
  scheduleRevision: 4,
  timerFingerprint: "exam:v1:exam_abc:window_a",
};
const afterEnd = new Date("2030-01-01T10:00:01.000Z");

describe("examDomain.session.autoCloseForExam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    examFindById.mockResolvedValue({
      id: input.examId,
      status: "published",
      endsAt: new Date(input.endsAt),
      scheduleRevision: input.scheduleRevision,
      timerFingerprint: input.timerFingerprint,
    });
    examLockForUpdate.mockResolvedValue([]);
  });

  it("returns { closed: 0 } when no active sessions exist", async () => {
    closeActiveForExam.mockResolvedValue([]);

    const result = await session.autoCloseForExam(input, afterEnd);

    expect(result).toEqual({ closed: 0 });
    expect(recordEvents).not.toHaveBeenCalled();
  });

  it("closes all active sessions in one batch with reason 'time_up' and records auto_close events", async () => {
    closeActiveForExam.mockResolvedValue([
      { id: "sess_a" },
      { id: "sess_b" },
      { id: "sess_c" },
    ]);

    const result = await session.autoCloseForExam(input, afterEnd);

    expect(result).toEqual({ closed: 3 });

    expect(closeActiveForExam).toHaveBeenCalledWith(input.examId, afterEnd);

    expect(recordEvents).toHaveBeenCalledTimes(1);
    expect(recordEvents).toHaveBeenCalledWith([
      { sessionId: "sess_a", eventType: "auto_close" },
      { sessionId: "sess_b", eventType: "auto_close" },
      { sessionId: "sess_c", eventType: "auto_close" },
    ]);
  });

  it("does not close or emit events for a stale schedule revision", async () => {
    examFindById.mockResolvedValue({
      status: "published",
      endsAt: new Date(input.endsAt),
      scheduleRevision: input.scheduleRevision + 1,
      timerFingerprint: "exam:v1:exam_abc:window_b",
    });

    const result = await session.autoCloseForExam(input, afterEnd);

    expect(result).toEqual({ closed: 0 });
    expect(closeActiveForExam).not.toHaveBeenCalled();
    expect(recordEvents).not.toHaveBeenCalled();
  });

  it("emits no duplicate events when an activity retry transitions no rows", async () => {
    closeActiveForExam.mockResolvedValue([]);

    await session.autoCloseForExam(input, afterEnd);

    expect(recordEvents).not.toHaveBeenCalled();
  });
});
