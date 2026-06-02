import { beforeEach, describe, expect, it, vi } from "vitest";

const { findAllActiveForExam, update, recordEvent } = vi.hoisted(() => ({
  findAllActiveForExam: vi.fn(),
  update: vi.fn(),
  recordEvent: vi.fn(),
}));

vi.mock("@nojv/db", () => {
  const txRepo = {
    findAllActiveForExam,
    update,
    recordEvent,
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

import { examDomain } from "@nojv/domain";

const { session } = examDomain;

describe("examDomain.session.autoCloseForExam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns { closed: 0 } when no active sessions exist", async () => {
    findAllActiveForExam.mockResolvedValue([]);

    const result = await session.autoCloseForExam("exam_abc");

    expect(result).toEqual({ closed: 0 });
    expect(update).not.toHaveBeenCalled();
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("closes each active session with reason 'time_up' and records an auto_close event", async () => {
    findAllActiveForExam.mockResolvedValue([
      { id: "sess_a", examId: "exam_abc", userId: "usr_1", endedAt: null },
      { id: "sess_b", examId: "exam_abc", userId: "usr_2", endedAt: null },
      { id: "sess_c", examId: "exam_abc", userId: "usr_3", endedAt: null },
    ]);

    const result = await session.autoCloseForExam("exam_abc");

    expect(result).toEqual({ closed: 3 });

    expect(update).toHaveBeenCalledTimes(3);
    expect(update).toHaveBeenNthCalledWith(
      1,
      "sess_a",
      expect.objectContaining({ releaseReason: "time_up" }),
    );
    expect(update).toHaveBeenNthCalledWith(
      2,
      "sess_b",
      expect.objectContaining({ releaseReason: "time_up" }),
    );
    expect(update).toHaveBeenNthCalledWith(
      3,
      "sess_c",
      expect.objectContaining({ releaseReason: "time_up" }),
    );

    expect(recordEvent).toHaveBeenCalledTimes(3);
    expect(recordEvent).toHaveBeenNthCalledWith(1, {
      sessionId: "sess_a",
      eventType: "auto_close",
    });
    expect(recordEvent).toHaveBeenNthCalledWith(2, {
      sessionId: "sess_b",
      eventType: "auto_close",
    });
    expect(recordEvent).toHaveBeenNthCalledWith(3, {
      sessionId: "sess_c",
      eventType: "auto_close",
    });
  });

  it("queries only sessions belonging to the given exam id", async () => {
    findAllActiveForExam.mockResolvedValue([]);

    await session.autoCloseForExam("exam_xyz");

    expect(findAllActiveForExam).toHaveBeenCalledWith("exam_xyz");
    expect(findAllActiveForExam).toHaveBeenCalledTimes(1);
  });
});
