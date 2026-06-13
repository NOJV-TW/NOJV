import { beforeEach, describe, expect, it, vi } from "vitest";

const { findAllActiveForExam, update, recordEvent, updateManyById, recordEvents } = vi.hoisted(
  () => ({
    findAllActiveForExam: vi.fn(),
    update: vi.fn(),
    recordEvent: vi.fn(),
    updateManyById: vi.fn(),
    recordEvents: vi.fn(),
  }),
);

vi.mock("@nojv/db", () => {
  const txRepo = {
    findAllActiveForExam,
    update,
    recordEvent,
    updateManyById,
    recordEvents,
    findByUserAndExam: vi.fn(),
    findActiveForUser: vi.fn(),
    create: vi.fn(),
  };
  return {
    examRepo: {
      withTx: () => ({ findById: vi.fn() }),
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

describe("examDomain.session.autoCloseForExam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns { closed: 0 } when no active sessions exist", async () => {
    findAllActiveForExam.mockResolvedValue([]);

    const result = await session.autoCloseForExam("exam_abc");

    expect(result).toEqual({ closed: 0 });
    expect(updateManyById).not.toHaveBeenCalled();
    expect(recordEvents).not.toHaveBeenCalled();
  });

  it("closes all active sessions in one batch with reason 'time_up' and records auto_close events", async () => {
    findAllActiveForExam.mockResolvedValue([
      { id: "sess_a", examId: "exam_abc", userId: "usr_1", endedAt: null },
      { id: "sess_b", examId: "exam_abc", userId: "usr_2", endedAt: null },
      { id: "sess_c", examId: "exam_abc", userId: "usr_3", endedAt: null },
    ]);

    const result = await session.autoCloseForExam("exam_abc");

    expect(result).toEqual({ closed: 3 });

    expect(updateManyById).toHaveBeenCalledTimes(1);
    expect(updateManyById).toHaveBeenCalledWith(
      ["sess_a", "sess_b", "sess_c"],
      expect.objectContaining({ releaseReason: "time_up" }),
    );

    expect(recordEvents).toHaveBeenCalledTimes(1);
    expect(recordEvents).toHaveBeenCalledWith([
      { sessionId: "sess_a", eventType: "auto_close" },
      { sessionId: "sess_b", eventType: "auto_close" },
      { sessionId: "sess_c", eventType: "auto_close" },
    ]);
  });

  it("queries only sessions belonging to the given exam id", async () => {
    findAllActiveForExam.mockResolvedValue([]);

    await session.autoCloseForExam("exam_xyz");

    expect(findAllActiveForExam).toHaveBeenCalledWith("exam_xyz");
    expect(findAllActiveForExam).toHaveBeenCalledTimes(1);
  });
});
