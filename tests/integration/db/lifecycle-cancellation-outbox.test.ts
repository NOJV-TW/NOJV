import { describe, expect, it, vi } from "vitest";

import {
  assignmentDomain,
  configureDomainOrchestration,
  contestDomain,
  enqueueLifecycleCancellation,
  examDomain,
  LIFECYCLE_CANCELLATION_WORK_KIND,
} from "@nojv/application";
import { durableWorkRepo, runTransaction } from "@nojv/db";

import {
  createTestContest,
  createTestCourse,
  createTestExam,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

function unavailableOrchestration() {
  const unavailable = vi.fn(() => Promise.reject(new Error("Temporal unavailable")));
  configureDomainOrchestration({
    cancelAssignmentDueSoon: unavailable,
    cancelContestLifecycle: unavailable,
    cancelExamAutoClose: unavailable,
    cancelRejudge: unavailable,
    describeSubmissionJudge: vi.fn(() => Promise.resolve(null)),
    dispatchPlagiarismCheck: unavailable,
    dispatchRegistryGarbageCollect: vi.fn(() =>
      Promise.resolve({ workflowId: "registry-gc", alreadyRunning: false }),
    ),
    dispatchRejudge: vi.fn(() => Promise.resolve({ workflowId: "rejudge-test" })),
    dispatchSubmissionJudge: unavailable,
    ensureAssignmentDueSoon: unavailable,
    ensureContestLifecycle: unavailable,
    ensureExamAutoClose: unavailable,
    getRejudgeTriggeredBy: vi.fn(() => Promise.resolve(null)),
    probeTemporal: unavailable,
    queryRejudgeProgress: vi.fn(() => Promise.resolve({ completed: 0, total: 0 })),
    replaceAssignmentDueSoon: unavailable,
    replaceContestLifecycle: unavailable,
    replaceExamAutoClose: unavailable,
    terminateSubmissionJudge: unavailable,
  });
  return unavailable;
}

describe("lifecycle cancellation outbox", () => {
  it("commits cancellation with deleted rows without contacting unavailable Temporal", async () => {
    const temporalCall = unavailableOrchestration();
    const teacher = await createTestUser({ platformRole: "teacher" });
    const actor = {
      userId: teacher.id,
      username: teacher.username ?? "teacher",
      displayName: teacher.name,
      email: teacher.email,
      platformRole: "teacher" as const,
    };
    const course = await createTestCourse({ ownerId: teacher.id });
    const startsAt = new Date("2030-01-01T00:00:00.000Z");
    const endsAt = new Date("2030-01-02T00:00:00.000Z");
    const [assignment, exam, contest] = await Promise.all([
      testPrisma.assessment.create({
        data: {
          courseId: course.id,
          createdByUserId: teacher.id,
          title: "Draft assignment",
          summary: "Draft",
          status: "draft",
          opensAt: startsAt,
          closesAt: endsAt,
        },
      }),
      createTestExam({
        courseId: course.id,
        createdByUserId: teacher.id,
        status: "draft",
        startsAt,
        endsAt,
      }),
      createTestContest({
        createdByUserId: teacher.id,
        visibility: "draft",
        startsAt,
        endsAt,
      }),
    ]);

    await assignmentDomain.deleteAssignmentDraft(actor, assignment.id);
    await examDomain.deleteExamDraft(actor, exam.id);
    await contestDomain.deleteContestDraft(actor, contest.id);

    expect(temporalCall).not.toHaveBeenCalled();
    await expect(
      Promise.all([
        testPrisma.assessment.findUnique({ where: { id: assignment.id } }),
        testPrisma.exam.findUnique({ where: { id: exam.id } }),
        testPrisma.contest.findUnique({ where: { id: contest.id } }),
      ]),
    ).resolves.toEqual([null, null, null]);
    const work = await testPrisma.durableWork.findMany({
      where: { kind: LIFECYCLE_CANCELLATION_WORK_KIND },
      orderBy: { createdAt: "asc" },
    });
    expect(work).toHaveLength(3);
    expect(work.map(({ status }) => status)).toEqual(["pending", "pending", "pending"]);
    expect(work.map(({ payload }) => payload)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "assignment" }),
        expect.objectContaining({ type: "exam" }),
        expect.objectContaining({ type: "contest" }),
      ]),
    );
  });

  it("deduplicates the same cancellation and retries its exact immutable payload", async () => {
    const payload = {
      type: "exam" as const,
      input: {
        examId: "exam-retry",
        startsAt: "2030-01-01T00:00:00.000Z",
        endsAt: "2030-01-02T00:00:00.000Z",
        scheduleRevision: 7,
        timerFingerprint: "exam:v1:exam-retry:1000:2000:3000",
      },
    };
    await runTransaction(async (tx) => {
      await enqueueLifecycleCancellation(tx, payload);
      await enqueueLifecycleCancellation(tx, payload);
    });
    expect(
      await testPrisma.durableWork.count({
        where: { kind: LIFECYCLE_CANCELLATION_WORK_KIND },
      }),
    ).toBe(1);

    const now = new Date("2030-01-01T00:00:00.000Z");
    const [first] = await durableWorkRepo.claimBatch({
      kinds: [LIFECYCLE_CANCELLATION_WORK_KIND],
      owner: "worker-a",
      limit: 1,
      now,
      leaseDurationMs: 1_000,
    });
    const retryAt = new Date(now.getTime() + 1_000);
    await durableWorkRepo.retryOrDead({
      id: first.id,
      owner: "worker-a",
      attempt: first.attempt,
      now,
      retryAt,
      error: "Temporal unavailable",
    });
    const [second] = await durableWorkRepo.claimBatch({
      kinds: [LIFECYCLE_CANCELLATION_WORK_KIND],
      owner: "worker-b",
      limit: 1,
      now: retryAt,
      leaseDurationMs: 1_000,
    });

    expect(second).toMatchObject({ attempt: 2, payload });
  });
});
