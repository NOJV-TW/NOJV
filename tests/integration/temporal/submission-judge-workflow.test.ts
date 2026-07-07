import { fileURLToPath } from "node:url";

import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { submissionJudgeWorkflow } from "../../../apps/worker/src/workflows/submission-judge";

const workflowsPath = fileURLToPath(
  new URL("../../../apps/worker/src/workflows/submission-judge.ts", import.meta.url),
);

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

type Activities = Record<string, (...args: unknown[]) => Promise<unknown>>;

function buildActivities(overrides: Partial<Activities> = {}): Activities {
  return {
    snapshotSubmissionForRejudge: vi.fn(async () => ({
      logId: "log_1",
      oldStatus: "accepted",
    })),
    fetchJudgeContext: vi.fn(async () => ({ problemType: "full_source", advanced: null })),
    executeSandbox: vi.fn(async () => ({ testcaseResults: [] })),
    completeSubmission: vi.fn(async () => ({
      id: "sub_1",
      contestId: null,
      examId: null,
      userId: "usr_1",
      verdict: "accepted",
      score: 100,
    })),
    finalizeRejudgeLog: vi.fn(async () => undefined),
    restoreSubmissionForCancelledRejudge: vi.fn(async () => undefined),
    updateContestScores: vi.fn(async () => null),
    updateExamScores: vi.fn(async () => undefined),
    publishScoreboardUpdate: vi.fn(async () => undefined),
    publishVerdict: vi.fn(async () => undefined),
    ...overrides,
  };
}

const baseInput = {
  submissionId: "sub_1",
  draft: { problemId: "prob_1", language: "python", sourceCode: "print(1)" },
} as never;

async function runWorker(activities: Activities, body: () => Promise<void>): Promise<void> {
  const judgeWorker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: "judge-test",
    workflowsPath,
    activities,
  });
  const platformWorker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: "platform",
    workflowsPath,
    activities,
  });
  await judgeWorker.runUntil(platformWorker.runUntil(body()));
}

describe("submissionJudgeWorkflow (TestWorkflowEnvironment)", () => {
  it("runs the happy path: executes, completes, publishes the verdict", async () => {
    const activities = buildActivities();
    await runWorker(activities, async () => {
      await env.client.workflow.execute(submissionJudgeWorkflow, {
        args: [baseInput],
        taskQueue: "judge-test",
        workflowId: `wf-happy-${String(Date.now())}`,
      });
    });
    expect(activities.fetchJudgeContext).toHaveBeenCalledTimes(1);
    expect(activities.executeSandbox).toHaveBeenCalledTimes(1);
    expect(activities.completeSubmission).toHaveBeenCalledTimes(1);
    expect(activities.publishVerdict).toHaveBeenCalledTimes(1);
    expect(activities.snapshotSubmissionForRejudge).not.toHaveBeenCalled();
  });

  it("on rejudge: snapshots first, then finalizes the rejudge log", async () => {
    const activities = buildActivities();
    await runWorker(activities, async () => {
      await env.client.workflow.execute(submissionJudgeWorkflow, {
        args: [{ ...baseInput, forRejudge: { triggeredByUserId: "usr_admin" } }],
        taskQueue: "judge-test",
        workflowId: `wf-rejudge-${String(Date.now())}`,
      });
    });
    expect(activities.snapshotSubmissionForRejudge).toHaveBeenCalledTimes(1);
    expect(activities.finalizeRejudgeLog).toHaveBeenCalledTimes(1);
    expect(activities.restoreSubmissionForCancelledRejudge).not.toHaveBeenCalled();
  });

  it("cancellation during a rejudge restores the prior status (never finalizes)", async () => {
    let signalStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const activities = buildActivities({
      executeSandbox: vi.fn(async () => {
        const { Context } = await import("@temporalio/activity");
        signalStarted();
        await Context.current().cancelled;
        return { testcaseResults: [] };
      }),
    });
    await runWorker(activities, async () => {
      const handle = await env.client.workflow.start(submissionJudgeWorkflow, {
        args: [{ ...baseInput, forRejudge: { triggeredByUserId: "usr_admin" } }],
        taskQueue: "judge-test",
        workflowId: `wf-cancel-${String(Date.now())}`,
      });
      await started;
      await handle.cancel();
      await expect(handle.result()).rejects.toThrow();
    });
    expect(activities.restoreSubmissionForCancelledRejudge).toHaveBeenCalledWith(
      "sub_1",
      "accepted",
    );
    expect(activities.finalizeRejudgeLog).not.toHaveBeenCalled();
  });

  it("non-cancellation failure during a rejudge restores the prior status", async () => {
    const activities = buildActivities({
      executeSandbox: vi.fn(async () => {
        throw new Error("sandbox infra failure");
      }),
    });
    await runWorker(activities, async () => {
      const handle = await env.client.workflow.start(submissionJudgeWorkflow, {
        args: [{ ...baseInput, forRejudge: { triggeredByUserId: "usr_admin" } }],
        taskQueue: "judge-test",
        workflowId: `wf-fail-${String(Date.now())}`,
      });
      await expect(handle.result()).rejects.toThrow();
    });
    expect(activities.restoreSubmissionForCancelledRejudge).toHaveBeenCalledWith(
      "sub_1",
      "accepted",
    );
    expect(activities.finalizeRejudgeLog).not.toHaveBeenCalled();
  });
});
