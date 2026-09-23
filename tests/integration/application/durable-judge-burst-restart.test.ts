import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { configureDomainOrchestration, submissionDomain as judge } from "@nojv/application";
import { effectiveTimeLimitMs, JUDGE_STAGE_CASES, type SandboxExecutor } from "@nojv/core";
import { prismaAdapterClient as db, runTransaction } from "@nojv/db";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as judgeActivities from "../../../apps/worker/src/activities/judge-execution";
import { setExecutorOwner } from "../../../apps/worker/src/activities/judge";
import { ExecutorOwner } from "../../../apps/worker/src/services/executor-owner";
import {
  createTestProblem,
  createTestSubmission,
  createTestUser,
} from "../../fixtures/factories";

const workflowsPath = fileURLToPath(
  new URL("../../../apps/worker/src/workflows/durable-judge.ts", import.meta.url),
);
const ORIGINAL_IMAGE = `sandbox@sha256:${"a".repeat(64)}`;
const SUBMISSIONS = 100;
const STAGES = 3;
const CASES = JUDGE_STAGE_CASES * (STAGES - 1) + 1;
const SLOTS = 20;
let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createLocal();
}, 120_000);
afterAll(async () => {
  await env?.teardown();
});

async function until(assertion: () => Promise<boolean>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (!(await assertion())) {
    if (Date.now() >= deadline)
      throw new Error("Timed out waiting for durable judge progress.");
    await delay(100);
  }
}

describe("durable judge database burst and worker restart", () => {
  it("drains 100 mixed-class multi-stage submissions without repeating checkpoints or converting capacity to SE", async () => {
    vi.stubEnv("SANDBOX_IMAGE", ORIGINAL_IMAGE);
    const teacher = await createTestUser({ platformRole: "teacher" });
    const user = await createTestUser();
    const problem = await createTestProblem({ authorId: teacher.id });
    const testcase = await db.testcase.findFirstOrThrow({
      where: { testcaseSet: { problemId: problem.id } },
    });
    await db.testcaseSet.update({
      where: { id: testcase.testcaseSetId },
      data: { weight: 100 },
    });
    await db.testcase.createMany({
      data: Array.from({ length: CASES - 1 }, (_, index) => ({
        id: randomUUID(),
        testcaseSetId: testcase.testcaseSetId,
        ordinal: index + 2,
        inputStorage: testcase.inputStorage!,
        outputStorage: testcase.outputStorage!,
      })),
    });
    const executions = [];
    for (let index = 0; index < SUBMISSIONS; index++) {
      const submission = await createTestSubmission({
        userId: user.id,
        problemId: problem.id,
        status: "queued",
        sourceCode: "print(3)",
      });
      const pinned = await judge.prepareJudgeSnapshot(submission.id, {
        problemId: problem.id,
        language: submission.language,
        sampleOnly: false,
      });
      const execution = await runTransaction((tx) =>
        judge.createJudgeExecution(tx, {
          submissionId: submission.id,
          ...pinned,
          ...(index % 5 === 4 ? { operationId: "burst-background" } : {}),
        }),
      );
      executions.push(execution);
    }
    const queuePrefix = `burst-${randomUUID()}`;
    const foregroundQueue = `${queuePrefix}-foreground`;
    const backgroundQueue = `${queuePrefix}-background`;
    const stageRuns = new Map<string, number>();
    const finalizations = new Map<string, number>();
    const publications = new Map<string, number>();
    const transitions: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const sandbox: SandboxExecutor = {
      async execute(request, execution) {
        const key = `${request.submissionId}:${request.testcases[0]!.index}`;
        stageRuns.set(key, (stageRuns.get(key) ?? 0) + 1);
        expect(request.sandboxImage).toBe(ORIGINAL_IMAGE);
        expect(request.limits.timeoutMs).toBe(effectiveTimeLimitMs(1000, "python"));
        expect(request.sourceCode).toBe("print(3)");
        expect(
          request.testcases.every((test) => test.input === "1 2" && test.output === "3"),
        ).toBe(true);
        active++;
        maximumActive = Math.max(maximumActive, active);
        try {
          await delay(75, undefined, { signal: execution.signal });
          return {
            testcaseResults: request.testcases.map((test) => ({
              index: test.index,
              verdict: "AC" as const,
              stdout: "3",
              stderr: "",
              exitCode: 0,
              timeMs: 1,
              memoryKb: 1,
            })),
          };
        } finally {
          active--;
        }
      },
    };
    setExecutorOwner(new ExecutorOwner(sandbox));
    configureDomainOrchestration({} as never);
    const activities = {
      ...judgeActivities,
      async setJudgeExecutionState(
        ...args: Parameters<typeof judgeActivities.setJudgeExecutionState>
      ) {
        transitions.push(args[2]);
        return judgeActivities.setJudgeExecutionState(...args);
      },
      async completePinnedJudge(executionId: string, workflowId: string) {
        finalizations.set(executionId, (finalizations.get(executionId) ?? 0) + 1);
        return judgeActivities.completePinnedJudge(executionId, workflowId);
      },
      async publishVerdict(submission: { id: string }) {
        publications.set(submission.id, (publications.get(submission.id) ?? 0) + 1);
      },
    };
    const createJudgeWorker = (taskQueue: string) =>
      Worker.create({
        connection: env.nativeConnection,
        taskQueue,
        workflowsPath,
        activities,
        maxConcurrentActivityTaskExecutions: SLOTS / 2,
        maxConcurrentWorkflowTaskExecutions: 100,
        shutdownGraceTime: "10s",
      });
    let workers: Worker[] = [];
    let runs: Promise<void>[] = [];
    const startWorkers = async () => {
      workers = await Promise.all([
        createJudgeWorker(foregroundQueue),
        createJudgeWorker(backgroundQueue),
        Worker.create({
          connection: env.nativeConnection,
          taskQueue: "judge-state",
          activities,
          shutdownGraceTime: "10s",
        }),
      ]);
      runs = workers.map((worker) => worker.run());
      for (const run of runs) void run.catch(() => undefined);
    };
    const stopWorkers = async () => {
      for (const worker of workers) if (worker.getState() === "RUNNING") worker.shutdown();
      await Promise.all(runs);
      workers = [];
      runs = [];
    };
    const platform = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: "platform",
      workflowsPath,
      activities,
    });
    const platformRun = platform.run();
    void platformRun.catch(() => undefined);
    try {
      await startWorkers();
      const handles = await Promise.all(
        executions.map((execution) =>
          env.client.workflow.start("durableJudgeWorkflow", {
            workflowId: execution.workflowId,
            taskQueue:
              execution.queueClass === "foreground" ? foregroundQueue : backgroundQueue,
            args: [{ executionId: execution.id }],
          }),
        ),
      );
      await until(async () => (await db.judgeStage.count()) >= 20, 90_000);
      await stopWorkers();
      const checkpointKeys = new Set(
        (await db.judgeStage.findMany()).map((stage) => `${stage.executionId}:${stage.index}`),
      );
      expect(checkpointKeys.size).toBeGreaterThanOrEqual(20);
      expect(checkpointKeys.size).toBeLessThan(SUBMISSIONS * STAGES);
      expect(
        await db.judgeExecution.count({ where: { state: { not: "completed" } } }),
      ).toBeGreaterThan(0);
      expect(await db.submission.count({ where: { status: "system_error" } })).toBe(0);
      const checkpointRuns = new Map(stageRuns);
      await db.problem.update({
        where: { id: problem.id },
        data: {
          timeLimitMs: 9000,
          storageGeneration: { increment: 1 },
        },
      });
      vi.stubEnv("SANDBOX_IMAGE", `sandbox@sha256:${"b".repeat(64)}`);
      setExecutorOwner(new ExecutorOwner(sandbox));
      await startWorkers();
      await until(
        async () =>
          (await db.judgeExecution.count({ where: { state: "completed" } })) === SUBMISSIONS,
        240_000,
      );
      await Promise.all(handles.map((handle) => handle.result()));
      await stopWorkers();
      expect(await db.judgeExecution.count({ where: { state: "completed" } })).toBe(
        SUBMISSIONS,
      );
      expect(await db.judgeExecution.count({ where: { leaseToken: { not: null } } })).toBe(0);
      expect(
        await db.submission.count({
          where: { status: "accepted", score: 100, activeJudgeRunId: null },
        }),
      ).toBe(SUBMISSIONS);
      expect(await db.judgeStage.count()).toBe(SUBMISSIONS * STAGES);
      expect(stageRuns.size).toBe(SUBMISSIONS * STAGES);
      expect([...stageRuns.values()].every((count) => count === 1)).toBe(true);
      for (const [key, count] of checkpointRuns) expect(stageRuns.get(key)).toBe(count);
      expect(finalizations.size).toBe(SUBMISSIONS);
      expect([...finalizations.values()].every((count) => count === 1)).toBe(true);
      expect(publications.size).toBe(SUBMISSIONS);
      expect([...publications.values()].every((count) => count === 1)).toBe(true);
      expect(transitions).not.toContain("recovering");
      expect(transitions).not.toContain("blocked");
      expect(maximumActive).toBeGreaterThan(1);
      expect(maximumActive).toBeLessThanOrEqual(SLOTS);
      expect(await db.submissionRejudgeLog.count()).toBe(0);
      for (const original of executions) {
        const current = await db.judgeExecution.findUniqueOrThrow({
          where: { id: original.id },
        });
        expect(current.snapshot).toEqual(original.snapshot);
        expect(current.generation).toBe(original.generation);
        expect(current.workflowId).toBe(original.workflowId);
      }
    } finally {
      await stopWorkers();
      if (platform.getState() === "RUNNING") platform.shutdown();
      await platformRun;
      vi.unstubAllEnvs();
    }
  }, 350_000);
});
