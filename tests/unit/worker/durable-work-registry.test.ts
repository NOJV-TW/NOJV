import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cleanupUnreferencedStorageObject: vi.fn(),
  deliverNotificationEmail: vi.fn(),
  executeRejudgeDispatch: vi.fn(),
  executeSubmissionJudgeDispatch: vi.fn(),
  publishNotificationSse: vi.fn(),
  publishScoreboardUpdate: vi.fn(),
  updateContestScores: vi.fn(),
  updateExamScores: vi.fn(),
}));

vi.mock("@nojv/application", () => ({
  cleanupUnreferencedStorageObject: mocks.cleanupUnreferencedStorageObject,
  contestDomain: { updateContestScores: mocks.updateContestScores },
  examDomain: { updateExamScores: mocks.updateExamScores },
  notificationDomain: {
    NOTIFICATION_EMAIL_WORK_KIND: "notification.email",
    NOTIFICATION_SSE_WORK_KIND: "notification.sse",
    deliverNotificationEmail: mocks.deliverNotificationEmail,
    publishNotificationSse: mocks.publishNotificationSse,
  },
  scoreOverrideDomain: { SCORE_CONVERGENCE_WORK_KIND: "score.converge" },
  STORAGE_OBJECT_CLEANUP_KIND: "storage.object.cleanup",
  submissionDomain: {
    REJUDGE_DISPATCH_WORK_KIND: "submission.rejudge.dispatch",
    SUBMISSION_JUDGE_DISPATCH_WORK_KIND: "submission.judge.dispatch",
    executeRejudgeDispatch: mocks.executeRejudgeDispatch,
    executeSubmissionJudgeDispatch: mocks.executeSubmissionJudgeDispatch,
  },
}));

vi.mock("@nojv/redis", () => ({
  pubsub: { publishScoreboardUpdate: mocks.publishScoreboardUpdate },
}));

import { durableWorkHandlers } from "../../../apps/worker/src/activities/durable-work-registry";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("durable work handlers", () => {
  it("publishes an immutable SSE snapshot without loading the notification row", async () => {
    const payload = {
      notificationId: "notification-1",
      userId: "user-1",
      event: {
        type: "notification",
        id: "notification-1",
        notificationType: "course_enrolled",
        params: { courseId: "course-1" },
        linkUrl: "/courses/course-1",
        createdAt: "2030-01-01T00:00:00.000Z",
      },
    };
    await durableWorkHandlers["notification.sse"](payload);

    expect(mocks.publishNotificationSse).toHaveBeenCalledWith(payload);
  });

  it("delivers the immutable email snapshot", async () => {
    const payload = {
      notificationId: "notification-1",
      disposition: "send",
      messageId: "<notification.notification-1@nojv.local>",
      to: "student@example.com",
      subject: "Subject",
      html: "<p>Body</p>",
    };
    await durableWorkHandlers["notification.email"](payload);

    expect(mocks.deliverNotificationEmail).toHaveBeenCalledWith(payload);
  });

  it("converges contest score before publishing the scoreboard signal", async () => {
    mocks.updateContestScores.mockResolvedValue("contest-1");

    await durableWorkHandlers["score.converge"]({
      context: { type: "contest", contestId: "contest-1" },
      userId: "user-1",
    });

    expect(mocks.updateContestScores).toHaveBeenCalledWith("contest-1", "user-1");
    expect(mocks.publishScoreboardUpdate).toHaveBeenCalledWith("contest-1");
  });

  it("converges exam score without a contest signal", async () => {
    await durableWorkHandlers["score.converge"]({
      context: { type: "exam", examId: "exam-1" },
      userId: "user-1",
    });

    expect(mocks.updateExamScores).toHaveBeenCalledWith("exam-1", "user-1");
    expect(mocks.publishScoreboardUpdate).not.toHaveBeenCalled();
  });

  it("rejects malformed payloads before any side effect", async () => {
    await expect(
      durableWorkHandlers["score.converge"]({
        context: { type: "contest" },
        userId: "user-1",
      }),
    ).rejects.toThrow();
    expect(mocks.updateContestScores).not.toHaveBeenCalled();
    expect(mocks.updateExamScores).not.toHaveBeenCalled();
  });
});
