import { beforeEach, describe, expect, it, vi } from "vitest";

const autoCloseForExamMock = vi.hoisted(() => vi.fn());

vi.mock("@nojv/application", () => ({
  assignmentDomain: {},
  contestDomain: {},
  examDomain: {
    session: {
      autoCloseForExam: autoCloseForExamMock,
    },
  },
  notificationDomain: {},
  isAssignmentLifecycleCurrent: vi.fn(),
  isContestLifecycleCurrent: vi.fn(),
  isExamLifecycleCurrent: vi.fn(),
  userDomain: {},
}));

vi.mock("@nojv/redis", () => ({
  pubsub: {
    publishVerdict: vi.fn(),
    publishContestEvent: vi.fn(),
  },
}));

import { closeActiveSessionsForExam } from "../../../apps/worker/src/activities/lifecycle";

describe("closeActiveSessionsForExam activity", () => {
  const input = {
    examId: "exam_abc",
    startsAt: "2030-01-01T09:00:00.000Z",
    endsAt: "2030-01-01T10:00:00.000Z",
    scheduleRevision: 4,
    timerFingerprint: "exam:v1:exam_abc:window_a",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to examDomain.session.autoCloseForExam and returns its result", async () => {
    autoCloseForExamMock.mockResolvedValue({ closed: 5 });

    const result = await closeActiveSessionsForExam(input);

    expect(autoCloseForExamMock).toHaveBeenCalledTimes(1);
    expect(autoCloseForExamMock).toHaveBeenCalledWith(input);
    expect(result).toEqual({ closed: 5 });
  });
});
