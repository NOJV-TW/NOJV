import { fileURLToPath } from "node:url";

import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  AssignmentDueSoonInput,
  ContestLifecycleInput,
  ExamAutoCloseInput,
} from "@nojv/core";

const workflowsPath = fileURLToPath(
  new URL("../../../apps/worker/src/workflows/index.ts", import.meta.url),
);
const WORKFLOW_TEST_TIMEOUT_MS = 30_000;

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
}, 120_000);

afterAll(async () => {
  await env.teardown();
});

function schedule(baseTimeMs: number, afterMs: number): string {
  return new Date(baseTimeMs + afterMs).toISOString();
}

async function runWorkflow(
  workflowType: string,
  input: AssignmentDueSoonInput | ContestLifecycleInput | ExamAutoCloseInput,
  activities: Record<string, (...args: never[]) => unknown>,
) {
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: "lifecycle-test",
    workflowsPath,
    activities,
  });
  const workflowId = `${workflowType}-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
  const history = await worker.runUntil(async () => {
    const handle = await env.client.workflow.start(workflowType, {
      args: [input],
      taskQueue: "lifecycle-test",
      workflowId,
    });
    await handle.result();
    return handle.fetchHistory();
  });
  return { workflowId, history };
}

describe("lifecycle workflows (TestWorkflowEnvironment)", () => {
  it(
    "keeps the newer occurrence when an older start races on the stable workflow id",
    async () => {
      const concurrentEnv = await TestWorkflowEnvironment.createTimeSkipping();
      const now = await concurrentEnv.currentTimeMs();
      const current: ExamAutoCloseInput = {
        examId: "exam_concurrent",
        startsAt: schedule(now, 86_400_000),
        endsAt: schedule(now, 172_800_000),
        scheduleRevision: 5,
        timerFingerprint: "exam:v1:exam_concurrent:1000:window_b",
      };
      const stale: ExamAutoCloseInput = {
        ...current,
        scheduleRevision: 4,
        timerFingerprint: "exam:v1:exam_concurrent:1000:window_a",
      };
      const worker = await Worker.create({
        connection: concurrentEnv.nativeConnection,
        taskQueue: "lifecycle-concurrency-test",
        workflowsPath,
        activities: {
          closeActiveSessionsForExam: vi.fn(() => Promise.resolve({ closed: 0 })),
          fanoutExamStartingSoon: vi.fn(() => Promise.resolve()),
        },
      });
      const workflowId = `exam-auto-close-concurrent-${String(now)}`;

      try {
        await worker.runUntil(async () => {
          const winner = await concurrentEnv.client.workflow.start("examAutoCloseWorkflow", {
            args: [current],
            memo: {
              scheduleRevision: current.scheduleRevision,
              timerFingerprint: current.timerFingerprint,
            },
            taskQueue: "lifecycle-concurrency-test",
            workflowId,
          });
          const contender = await concurrentEnv.client.workflow.start("examAutoCloseWorkflow", {
            args: [stale],
            memo: {
              scheduleRevision: stale.scheduleRevision,
              timerFingerprint: stale.timerFingerprint,
            },
            taskQueue: "lifecycle-concurrency-test",
            workflowId,
            workflowIdConflictPolicy: "USE_EXISTING",
            workflowIdReusePolicy: "ALLOW_DUPLICATE",
          });
          const [winnerDescription, contenderDescription] = await Promise.all([
            winner.describe(),
            contender.describe(),
          ]);

          expect(contenderDescription.runId).toBe(winnerDescription.runId);
          expect(contenderDescription.memo).toMatchObject({
            scheduleRevision: current.scheduleRevision,
            timerFingerprint: current.timerFingerprint,
          });
          await winner.terminate("test completed");
        });
      } finally {
        await concurrentEnv.teardown();
      }
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );

  it(
    "carries the immutable exam schedule through to conditional auto-close",
    async () => {
      const closeActiveSessionsForExam = vi.fn(() => Promise.resolve({ closed: 2 }));
      const now = await env.currentTimeMs();
      const input: ExamAutoCloseInput = {
        examId: "exam_1",
        startsAt: schedule(now, 30_000),
        endsAt: schedule(now, 60_000),
        scheduleRevision: 4,
        timerFingerprint: "exam:v1:exam_1:window_a",
      };

      const { history } = await runWorkflow("examAutoCloseWorkflow", input, {
        closeActiveSessionsForExam,
        fanoutExamStartingSoon: vi.fn(() => Promise.resolve()),
      });

      expect(closeActiveSessionsForExam).toHaveBeenCalledOnce();
      expect(closeActiveSessionsForExam).toHaveBeenCalledWith(input);
      await expect(
        Worker.runReplayHistory({ workflowsPath }, history),
      ).resolves.toBeUndefined();
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );

  it(
    "closes a published exam immediately when recovery starts after its end",
    async () => {
      const closeActiveSessionsForExam = vi.fn(() => Promise.resolve({ closed: 1 }));
      const fanoutExamStartingSoon = vi.fn(() => Promise.resolve());
      const now = await env.currentTimeMs();
      const input: ExamAutoCloseInput = {
        examId: "exam_past_due",
        startsAt: schedule(now, -2 * 60 * 60_000),
        endsAt: schedule(now, -60 * 60_000),
        scheduleRevision: 1,
        timerFingerprint: "exam:v1:exam_past_due:1000:window_a",
      };

      await runWorkflow("examAutoCloseWorkflow", input, {
        closeActiveSessionsForExam,
        fanoutExamStartingSoon,
      });

      expect(closeActiveSessionsForExam).toHaveBeenCalledOnce();
      expect(closeActiveSessionsForExam).toHaveBeenCalledWith(input);
      expect(fanoutExamStartingSoon).not.toHaveBeenCalled();
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );

  it(
    "stops a stale contest workflow before advisory SSE events",
    async () => {
      const publishContestEvent = vi.fn(() => Promise.resolve());
      const finalizeContest = vi.fn(() => Promise.resolve(true));
      const now = await env.currentTimeMs();
      const input: ContestLifecycleInput = {
        contestId: "contest_1",
        startsAt: schedule(now, 30_000),
        endsAt: schedule(now, 60_000),
        frozenAt: null,
        scoreboardMode: "live",
        scheduleRevision: 3,
        timerFingerprint: "contest:v1:contest_1:window_a",
      };

      const { history } = await runWorkflow("contestLifecycleWorkflow", input, {
        activateContest: vi.fn(() => Promise.resolve(false)),
        fanoutContestStartingSoon: vi.fn(() => Promise.resolve()),
        finalizeContest,
        freezeScoreboard: vi.fn(() => Promise.resolve(true)),
        publishContestEvent,
      });

      expect(finalizeContest).not.toHaveBeenCalled();
      expect(publishContestEvent).not.toHaveBeenCalled();
      await expect(
        Worker.runReplayHistory({ workflowsPath }, history),
      ).resolves.toBeUndefined();
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );

  it(
    "finalizes a published contest when recovery starts after its end",
    async () => {
      const activateContest = vi.fn(() => Promise.resolve(true));
      const finalizeContest = vi.fn(() => Promise.resolve(true));
      const publishContestEvent = vi.fn(() => Promise.resolve());
      const now = await env.currentTimeMs();
      const input: ContestLifecycleInput = {
        contestId: "contest_past_due",
        startsAt: schedule(now, -2 * 60 * 60_000),
        endsAt: schedule(now, -60 * 60_000),
        frozenAt: null,
        scoreboardMode: "live",
        scheduleRevision: 1,
        timerFingerprint: "contest:v1:contest_past_due:1000:window_a",
      };

      await runWorkflow("contestLifecycleWorkflow", input, {
        activateContest,
        fanoutContestStartingSoon: vi.fn(() => Promise.resolve()),
        finalizeContest,
        freezeScoreboard: vi.fn(() => Promise.resolve(true)),
        publishContestEvent,
      });

      expect(activateContest).toHaveBeenCalledWith(input);
      expect(finalizeContest).toHaveBeenCalledWith(input);
      expect(publishContestEvent.mock.calls).toEqual([
        [input.contestId, "starting"],
        [input.contestId, "ending"],
      ]);
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );

  it(
    "passes the immutable assignment occurrence to the start activity",
    async () => {
      const fanoutAssignmentStarted = vi.fn(() => Promise.resolve());
      const now = await env.currentTimeMs();
      const input: AssignmentDueSoonInput = {
        assignmentId: "assignment_1",
        opensAt: schedule(now, 30_000),
        closesAt: schedule(now, 60_000),
        scheduleRevision: 2,
        timerFingerprint: "assessment:v1:assignment_1:window_a",
      };

      const { history } = await runWorkflow("assignmentDueSoonWorkflow", input, {
        fanoutAssignmentDueSoon: vi.fn(() => Promise.resolve()),
        fanoutAssignmentStarted,
      });

      expect(fanoutAssignmentStarted).toHaveBeenCalledWith(input);
      await expect(
        Worker.runReplayHistory({ workflowsPath }, history),
      ).resolves.toBeUndefined();
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );
});
