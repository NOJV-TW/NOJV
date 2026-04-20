import { beforeEach, describe, expect, it, vi } from "vitest";

const autoCloseForExamMock = vi.hoisted(() => vi.fn());

vi.mock("@nojv/domain", () => ({
  examDomain: {
    session: {
      autoCloseForExam: autoCloseForExamMock,
    },
  },
}));

import { closeActiveSessionsForExam } from "../../../packages/temporal/src/activities/exam-session";

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
