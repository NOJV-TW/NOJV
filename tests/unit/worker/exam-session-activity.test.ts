import { beforeEach, describe, expect, it, vi } from "vitest";

const autoCloseForExamMock = vi.hoisted(() => vi.fn());

vi.mock("@nojv/domain", () => ({
  assignmentDomain: {},
  contestDomain: {},
  examDomain: {
    session: {
      autoCloseForExam: autoCloseForExamMock,
    },
  },
  notificationDomain: {},
  userDomain: {},
}));

vi.mock("@nojv/redis", () => ({
  pubsub: {
    publishVerdict: vi.fn(),
    publishContestEvent: vi.fn(),
    publishAssessmentDeadline: vi.fn(),
  },
}));

import { closeActiveSessionsForExam } from "../../../apps/worker/src/activities/lifecycle";

describe("closeActiveSessionsForExam activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to examDomain.session.autoCloseForExam and returns its result", async () => {
    autoCloseForExamMock.mockResolvedValue({ closed: 5 });

    const result = await closeActiveSessionsForExam("exam_abc");

    expect(autoCloseForExamMock).toHaveBeenCalledTimes(1);
    expect(autoCloseForExamMock).toHaveBeenCalledWith("exam_abc");
    expect(result).toEqual({ closed: 5 });
  });
});
