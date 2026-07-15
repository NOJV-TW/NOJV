import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listAssignments,
  listContests,
  listExams,
  ensureAssignmentDueSoon,
  ensureContestLifecycle,
  ensureExamAutoClose,
} = vi.hoisted(() => ({
  listAssignments: vi.fn(),
  listContests: vi.fn(),
  listExams: vi.fn(),
  ensureAssignmentDueSoon: vi.fn(),
  ensureContestLifecycle: vi.fn(),
  ensureExamAutoClose: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  assessmentRepo: { listNeedingTimers: listAssignments },
  contestRepo: { listNeedingTimers: listContests },
  examRepo: { listNeedingTimers: listExams },
}));

import {
  LIFECYCLE_RECONCILE_BATCH_SIZE,
  configureDomainOrchestration,
  reconcileLifecycleTimers,
} from "@nojv/application";

beforeEach(() => {
  vi.clearAllMocks();
  listAssignments.mockResolvedValue([]);
  listContests.mockResolvedValue([]);
  listExams.mockResolvedValue([]);
  configureDomainOrchestration({
    cancelAssignmentDueSoon: vi.fn(),
    cancelContestLifecycle: vi.fn(),
    cancelExamAutoClose: vi.fn(),
    cancelRejudge: vi.fn(),
    describeSubmissionJudge: vi.fn(),
    dispatchPlagiarismCheck: vi.fn(),
    dispatchRegistryGarbageCollect: vi.fn(),
    dispatchRejudge: vi.fn(),
    dispatchSubmissionJudge: vi.fn(),
    ensureAssignmentDueSoon,
    ensureContestLifecycle,
    ensureExamAutoClose,
    getRejudgeTriggeredBy: vi.fn(),
    probeTemporal: vi.fn(),
    queryRejudgeProgress: vi.fn(),
    replaceAssignmentDueSoon: vi.fn(),
    replaceContestLifecycle: vi.fn(),
    replaceExamAutoClose: vi.fn(),
    terminateSubmissionJudge: vi.fn(),
  });
});

describe("reconcileLifecycleTimers", () => {
  it("ensures every current schedule identity without replacing it", async () => {
    listExams.mockResolvedValue([
      {
        id: "exam_1",
        startsAt: new Date("2030-01-01T09:00:00.000Z"),
        endsAt: new Date("2030-01-01T10:00:00.000Z"),
        scheduleRevision: 4,
        timerFingerprint: "exam:v1:exam_1:window_a",
      },
    ]);
    listContests.mockResolvedValue([
      {
        id: "contest_1",
        startsAt: new Date("2030-01-02T09:00:00.000Z"),
        endsAt: new Date("2030-01-02T10:00:00.000Z"),
        frozenAt: null,
        scoreboardMode: "live",
        scheduleRevision: 2,
        timerFingerprint: "contest:v1:contest_1:window_a",
      },
    ]);
    listAssignments.mockResolvedValue([
      {
        id: "assignment_1",
        opensAt: new Date("2030-01-03T09:00:00.000Z"),
        closesAt: new Date("2030-01-03T10:00:00.000Z"),
        scheduleRevision: 3,
        timerFingerprint: "assessment:v1:assignment_1:window_a",
      },
    ]);

    await expect(reconcileLifecycleTimers()).resolves.toEqual({
      exams: 1,
      contests: 1,
      assignments: 1,
      next: null,
    });

    expect(ensureExamAutoClose).toHaveBeenCalledWith(
      expect.objectContaining({ scheduleRevision: 4 }),
    );
    expect(ensureContestLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ scheduleRevision: 2, scoreboardMode: "live" }),
    );
    expect(ensureAssignmentDueSoon).toHaveBeenCalledWith(
      expect.objectContaining({ scheduleRevision: 3 }),
    );
    expect(listExams).toHaveBeenCalledWith({
      now: expect.any(Date),
      take: LIFECYCLE_RECONCILE_BATCH_SIZE + 1,
    });
    expect(listContests).toHaveBeenCalledWith({
      now: expect.any(Date),
      take: LIFECYCLE_RECONCILE_BATCH_SIZE + 1,
    });
    expect(listAssignments).toHaveBeenCalledWith({
      now: expect.any(Date),
      take: LIFECYCLE_RECONCILE_BATCH_SIZE + 1,
    });
  });

  it("reconciles expired exams and contests returned for downtime recovery", async () => {
    listExams.mockResolvedValue([
      {
        id: "exam_past_due",
        startsAt: new Date("2020-01-01T09:00:00.000Z"),
        endsAt: new Date("2020-01-01T10:00:00.000Z"),
        scheduleRevision: 1,
        timerFingerprint: "exam:v1:exam_past_due:1000:window_a",
      },
    ]);
    listContests.mockResolvedValue([
      {
        id: "contest_past_due",
        startsAt: new Date("2020-01-02T09:00:00.000Z"),
        endsAt: new Date("2020-01-02T10:00:00.000Z"),
        frozenAt: null,
        scoreboardMode: "live",
        scheduleRevision: 1,
        timerFingerprint: "contest:v1:contest_past_due:1000:window_a",
      },
    ]);

    await reconcileLifecycleTimers();

    expect(ensureExamAutoClose).toHaveBeenCalledWith(
      expect.objectContaining({ examId: "exam_past_due" }),
    );
    expect(ensureContestLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ contestId: "contest_past_due" }),
    );
    expect(ensureAssignmentDueSoon).not.toHaveBeenCalled();
  });

  it("bounds each fair page and returns keyset cursors without restarting completed kinds", async () => {
    const exams = Array.from({ length: LIFECYCLE_RECONCILE_BATCH_SIZE + 1 }, (_, index) => ({
      id: `exam_${String(index).padStart(2, "0")}`,
      startsAt: new Date("2030-01-01T09:00:00.000Z"),
      endsAt: new Date("2030-01-01T10:00:00.000Z"),
      scheduleRevision: 1,
      timerFingerprint: `exam_${String(index)}`,
    }));
    listExams.mockResolvedValue(exams);

    await expect(
      reconcileLifecycleTimers({ contests: null, assignments: null }),
    ).resolves.toEqual({
      exams: LIFECYCLE_RECONCILE_BATCH_SIZE,
      contests: 0,
      assignments: 0,
      next: {
        exams: { afterId: exams[LIFECYCLE_RECONCILE_BATCH_SIZE - 1]!.id },
        contests: null,
        assignments: null,
      },
    });

    expect(ensureExamAutoClose).toHaveBeenCalledTimes(LIFECYCLE_RECONCILE_BATCH_SIZE);
    expect(listContests).not.toHaveBeenCalled();
    expect(listAssignments).not.toHaveBeenCalled();
  });
});
