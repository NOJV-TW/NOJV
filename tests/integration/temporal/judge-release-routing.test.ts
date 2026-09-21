import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker, bundleWorkflowCode, type WorkflowBundle } from "@temporalio/worker";
import { ApplicationFailure, type WorkflowHandle } from "@temporalio/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { JudgeAdmissionState } from "../../../apps/worker/src/services/judge-capacity";

let env: TestWorkflowEnvironment;
let bundle: WorkflowBundle;
let legacy: WorkflowBundle;
const coordinatorId = "judge-admission-v1";
interface State {
  admission: JudgeAdmissionState;
  dispatchRoute: string;
  draining: boolean;
  activeSubmissionIds: string[];
  activeRejudgeIds: string[];
  quotaReady: boolean;
  quotaManaged: boolean;
  paused: boolean;
}
const input = (id: string) => ({
  submissionId: id,
  draft: { problemId: "problem", language: "python", sourceCode: "print(1)" },
});
const pointer = (key: string) => ({ key, sha256: "a".repeat(64), size: 1 });
const delay = () => new Promise((resolve) => setTimeout(resolve, 10));
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 500; i++) {
    if (await check()) return;
    await delay();
  }
  throw new Error("Release state did not converge");
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  bundle = await bundleWorkflowCode({
    workflowsPath: fileURLToPath(
      new URL("../../../apps/worker/src/workflows/index.ts", import.meta.url),
    ),
  });
  const workerRequire = createRequire(
    new URL("../../../apps/worker/package.json", import.meta.url),
  );
  legacy = await bundleWorkflowCode({
    workflowsPath: fileURLToPath(
      new URL("./fixtures/legacy-submission-judge.ts", import.meta.url),
    ),
    webpackConfigHook: (config) => ({
      ...config,
      resolve: {
        ...config.resolve,
        alias: {
          ...config.resolve?.alias,
          "@temporalio/workflow": dirname(
            workerRequire.resolve("@temporalio/workflow/package.json"),
          ),
        },
      },
    }),
  });
}, 120_000);
afterAll(async () => {
  await env?.teardown();
});

function fixtures() {
  const runSubmissions = new Map<string, string>();
  const activities = {
    fetchSingleSubmissionForRejudge: vi.fn(async (id: string) => ({
      ...input(id),
      studentId: id,
      staged: true,
    })),
    snapshotSubmissionForRejudge: vi.fn(async () => ({ logId: "log", oldStatus: "accepted" })),
    finalizeRejudgeLog: vi.fn(async () => undefined),
    restoreSubmissionForCancelledRejudge: vi.fn(async () => undefined),
    startSubmissionJudgeRun: vi.fn(async () => undefined),
    fetchJudgeContext: vi.fn(async (id: string) => ({
      staged: true,
      problemType: "full_source",
      userId: id,
      createdAt: new Date(1000),
    })),
    completeSubmission: vi.fn(async () => null),
    failSubmissionJudgeRun: vi.fn(async () => true),
    initializeSandboxAttempt: vi.fn(async (id: string, _draft: unknown, runId: string) => {
      runSubmissions.set(runId, id);
      return {
        pointer: pointer(runId),
        studentId: id,
        mode: "standard",
        terminal: false,
        caseIndices: [0, 1, 2, 3, 4],
        resources: { cpuMillis: 1000, memoryBytes: 1024 },
        compilerResources: { cpuMillis: 1000, memoryBytes: 1024 },
        overhead: { cpuMillis: 0, memoryBytes: 0 },
      };
    }),
    prepareSandboxAttempt: vi.fn(
      async (_pointer: unknown, runId: string, nodeName: string) => ({
        artifact: { runId, pvcName: runId, pvcUid: runId, nodeName },
      }),
    ),
    executeSandboxWave: vi.fn(async (_pointer: unknown, runId: string) => pointer(runId)),
    finishSandboxAttempt: vi.fn(async () => ({
      result: { accepted: true, verdict: "accepted", score: 100, caseResults: [] },
      advancedJudgeVerificationSnapshot: null,
    })),
    executeSandbox: vi.fn(async () => ({
      result: { testcaseResults: [] },
      advancedJudgeVerificationSnapshot: null,
    })),
    recordAdmissionWait: vi.fn(async () => undefined),
    cleanupSandboxStage: vi.fn(async () => undefined),
    cleanupSandboxAttempt: vi.fn(async () => undefined),
    closedJudgeWorkflows: vi.fn(async (ids: string[]) => {
      const closed: string[] = [];
      for (const id of ids)
        if ((await env.client.workflow.getHandle(id).describe()).status.name !== "RUNNING")
          closed.push(id);
      return closed;
    }),
    refreshJudgeCapacity: vi.fn(
      async (_quarantine: unknown, _permits: unknown, managed: boolean) => ({
        quotaManaged: managed,
        quarantinedNodes: [],
        capacity: {
          observedAt: await env.currentTimeMs(),
          nodes: [
            {
              name: "node-a",
              eligible: true,
              allocatable: { cpuMillis: 2000, memoryBytes: 100_000 },
              budget: { cpuMillis: 1000, memoryBytes: 75_000 },
            },
          ],
        },
      }),
    ),
  };
  return { activities, runSubmissions };
}
async function withWorkers(
  activities: ReturnType<typeof fixtures>["activities"],
  body: (coordinator: WorkflowHandle, restart: () => Promise<void>) => Promise<void>,
) {
  let control = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: "judge-control",
    maxCachedWorkflows: 0,
    workflowBundle: bundle,
    activities,
  });
  const judge = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: "judge-capacity-v1",
    workflowBundle: bundle,
    activities,
  });
  let controlRun = control.run();
  const judgeRun = judge.run();
  const run = async () => {
    const coordinator = await env.client.workflow.start("judgeAdmissionWorkflow", {
      workflowId: coordinatorId,
      taskQueue: "judge-control",
      args: [],
    });
    try {
      await coordinator.signal("activateJudgeQuota");
      await coordinator.signal("pauseJudgeAdmission", false);
      await until(async () => (await coordinator.query<State>("admissionState")).quotaReady);
      await coordinator.executeUpdate("configureJudgeDispatch", {
        args: [{ route: "capacity", draining: false }],
      });
      await body(coordinator, async () => {
        control.shutdown();
        await controlRun;
        control = await Worker.create({
          connection: env.nativeConnection,
          taskQueue: "judge-control",
          maxCachedWorkflows: 0,
          workflowBundle: bundle,
          activities,
        });
        controlRun = control.run();
      });
    } finally {
      await coordinator.terminate("Release test cleanup");
    }
  };
  try {
    await run();
  } finally {
    control.shutdown();
    judge.shutdown();
    await Promise.all([controlRun, judgeRun]);
  }
}
async function dispatch(
  coordinator: WorkflowHandle,
  id: string,
  admissionOrder = { studentId: id, submittedAt: 1000 },
) {
  await coordinator.executeUpdate("dispatchJudgeWorkflow", {
    args: [
      {
        workflowId: `judge-${id}`,
        workflowType: "submissionJudgeWorkflow",
        input: input(id),
        admissionOrder,
      },
    ],
  });
  return env.client.workflow.getHandle(`judge-${id}`);
}

describe("judge release routing with real Temporal histories", () => {
  it("drains active submission retries and waves while redirecting never-started work to fresh legacy history", async () => {
    const { activities, runSubmissions } = fixtures();
    const entered = deferred();
    const resume = deferred();
    const prepare = activities.prepareSandboxAttempt.getMockImplementation()!;
    let failOnce = true;
    activities.prepareSandboxAttempt.mockImplementation(async (...args) => {
      if (failOnce) {
        failOnce = false;
        entered.resolve();
        await resume.promise;
        throw new Error("Transient artifact failure");
      }
      return prepare(...args);
    });
    await withWorkers(activities, async (coordinator, restart) => {
      const active = await dispatch(coordinator, "active");
      await entered.promise;
      const queued = await dispatch(coordinator, "queued");
      await until(
        async () =>
          (await coordinator.query<State>("admissionState")).admission.pending.length === 1,
      );
      await coordinator.executeUpdate("configureJudgeDispatch", {
        args: [{ route: "legacy", draining: true }],
      });
      await until(async () => (await queued.describe()).taskQueue === "judge");
      const fresh = await env.client.workflow
        .getHandle(queued.workflowId, (await queued.describe()).runId)
        .fetchHistory();
      expect(fresh.events?.some((event) => event.activityTaskScheduledEventAttributes)).toBe(
        false,
      );
      expect(
        fresh.events?.[0]?.workflowExecutionStartedEventAttributes?.continuedExecutionRunId,
      ).toBeTruthy();
      expect(
        activities.prepareSandboxAttempt.mock.calls.every(
          (call) => runSubmissions.get(call[1]) === "active",
        ),
      ).toBe(true);
      const beforeRestart = await coordinator.query<State>("admissionState");
      await restart();
      const afterRestart = await coordinator.query<State>("admissionState");
      expect(afterRestart.activeSubmissionIds).toEqual(beforeRestart.activeSubmissionIds);
      expect(afterRestart.draining).toBe(true);
      expect(afterRestart.dispatchRoute).toBe("legacy");
      const newlyAccepted = await dispatch(coordinator, "new-during-drain");
      expect((await newlyAccepted.describe()).taskQueue).toBe("judge");
      await dispatch(coordinator, "new-during-drain");
      resume.resolve();
      await active.result();
      expect(activities.prepareSandboxAttempt).toHaveBeenCalledTimes(2);
      expect(activities.executeSandboxWave).toHaveBeenCalledTimes(5);
      await until(
        async () =>
          (await coordinator.query<State>("admissionState")).activeSubmissionIds.length === 0,
      );
      const oldWorker = await Worker.create({
        connection: env.nativeConnection,
        taskQueue: "judge",
        workflowBundle: legacy,
        activities,
      });
      await oldWorker.runUntil(Promise.all([queued.result(), newlyAccepted.result()]));
      expect(activities.executeSandbox).toHaveBeenCalledTimes(2);
      expect(activities.failSubmissionJudgeRun).not.toHaveBeenCalled();
    });
  }, 60_000);

  it("preserves cancellation while draining and never redirects an active producer", async () => {
    const { activities } = fixtures();
    await withWorkers(activities, async (coordinator) => {
      await coordinator.signal("pauseJudgeAdmission", true);
      const queued = await dispatch(coordinator, "cancel-drain");
      await until(
        async () =>
          (await coordinator.query<State>("admissionState")).admission.pending.length === 1,
      );
      await coordinator.executeUpdate("configureJudgeDispatch", {
        args: [{ route: "legacy", draining: true }],
      });
      await queued.cancel();
      await expect(queued.result()).rejects.toThrow();
      expect(activities.prepareSandboxAttempt).not.toHaveBeenCalled();
      expect(activities.cleanupSandboxAttempt).toHaveBeenCalledOnce();
      expect((await queued.describe()).taskQueue).toBe("judge-capacity-v1");
    });
  }, 60_000);

  it("holds newly accepted submissions durably during forward cutover", async () => {
    const { activities } = fixtures();
    await withWorkers(activities, async (coordinator, restart) => {
      await coordinator.signal("pauseJudgeAdmission", true);
      await coordinator.executeUpdate("configureJudgeDispatch", {
        args: [{ route: "hold", draining: true }],
      });
      const accepted = await dispatch(coordinator, "held-cutover");
      await until(
        async () =>
          (await coordinator.query<State>("admissionState")).admission.pending.length === 1,
      );
      await restart();
      expect((await accepted.describe()).status.name).toBe("RUNNING");
      expect((await accepted.describe()).taskQueue).toBe("judge-capacity-v1");
      expect(activities.prepareSandboxAttempt).not.toHaveBeenCalled();
      await coordinator.signal("pauseJudgeAdmission", false);
      await coordinator.executeUpdate("configureJudgeDispatch", {
        args: [{ route: "capacity", draining: false }],
      });
      await accepted.result();
      expect(activities.prepareSandboxAttempt).toHaveBeenCalledOnce();
    });
  }, 60_000);

  it("rejects rollback while a routed rejudge parent is active and deduplicates its dispatch", async () => {
    const { activities } = fixtures();
    const entered = deferred();
    const resume = deferred();
    const prepare = activities.prepareSandboxAttempt.getMockImplementation()!;
    activities.prepareSandboxAttempt.mockImplementation(async (...args) => {
      entered.resolve();
      await resume.promise;
      return prepare(...args);
    });
    await withWorkers(activities, async (coordinator) => {
      const args: [object] = [
        {
          workflowId: "batch-release",
          workflowType: "rejudgeWorkflow",
          input: { mode: "single", submissionId: "rejudged", triggeredByUserId: "admin" },
        },
      ];
      await coordinator.executeUpdate("dispatchJudgeWorkflow", { args });
      await entered.promise;
      await coordinator.executeUpdate("dispatchJudgeWorkflow", { args });
      await expect(
        coordinator.executeUpdate("configureJudgeDispatch", {
          args: [{ route: "legacy", draining: true }],
        }),
      ).rejects.toThrow();
      expect((await coordinator.query<State>("admissionState")).dispatchRoute).toBe("capacity");
      resume.resolve();
      await env.client.workflow.getHandle("batch-release").result();
      await until(
        async () =>
          (await coordinator.query<State>("admissionState")).activeRejudgeIds.length === 0,
      );
      await coordinator.executeUpdate("configureJudgeDispatch", {
        args: [{ route: "legacy", draining: true }],
      });
      expect(activities.prepareSandboxAttempt).toHaveBeenCalledOnce();
    });
  }, 60_000);

  it("reserves FIFO order before an older submission context Activity stalls", async () => {
    const { activities, runSubmissions } = fixtures();
    const entered = deferred();
    const resume = deferred();
    const fetch = activities.fetchJudgeContext.getMockImplementation()!;
    activities.fetchJudgeContext.mockImplementation(async (id) => {
      if (id === "fifo-older") {
        entered.resolve();
        await resume.promise;
      }
      return { ...(await fetch(id)), userId: "same-student" };
    });
    const initialize = activities.initializeSandboxAttempt.getMockImplementation()!;
    activities.initializeSandboxAttempt.mockImplementation(async (...args) => ({
      ...(await initialize(...args)),
      studentId: "same-student",
    }));
    await withWorkers(activities, async (coordinator) => {
      const older = await dispatch(coordinator, "fifo-older", {
        studentId: "same-student",
        submittedAt: 1000,
      });
      await entered.promise;
      const newer = await dispatch(coordinator, "fifo-newer", {
        studentId: "same-student",
        submittedAt: 2000,
      });
      await until(
        async () =>
          (await coordinator.query<State>("admissionState")).admission.pending.length === 1,
      );
      expect(activities.prepareSandboxAttempt).not.toHaveBeenCalled();
      resume.resolve();
      await Promise.all([older.result(), newer.result()]);
      expect(
        activities.prepareSandboxAttempt.mock.calls.map((call) => runSubmissions.get(call[1])),
      ).toEqual(["fifo-older", "fifo-newer"]);
    });
  }, 60_000);

  it("retires reservations when a submission closes before registering its first attempt", async () => {
    const { activities } = fixtures();
    activities.fetchJudgeContext.mockRejectedValueOnce(
      ApplicationFailure.nonRetryable("Removed submission"),
    );
    await withWorkers(activities, async (coordinator) => {
      const failed = await dispatch(coordinator, "early-close");
      await expect(failed.result()).rejects.toThrow();
      await env.sleep("31s");
      await until(
        async () =>
          !(await coordinator.query<State>("admissionState")).admission.runs.some(
            (run) => run.runId === "dispatch/judge-early-close" && !run.finished,
          ),
      );
    });
  }, 60_000);

  it("waits for an in-flight quota write before durably relinquishing ownership", async () => {
    const { activities } = fixtures();
    const entered = deferred();
    const resume = deferred();
    const refresh = activities.refreshJudgeCapacity.getMockImplementation()!;
    let block = false;
    activities.refreshJudgeCapacity.mockImplementation(async (...args) => {
      if (block) {
        block = false;
        entered.resolve();
        await resume.promise;
      }
      return refresh(...args);
    });
    await withWorkers(activities, async (coordinator, restart) => {
      await expect(
        coordinator.executeUpdate("relinquishJudgeQuota", { args: [] }),
      ).rejects.toThrow();
      await coordinator.executeUpdate("configureJudgeDispatch", {
        args: [{ route: "legacy", draining: true }],
      });
      block = true;
      await coordinator.signal("activateJudgeQuota");
      await entered.promise;
      let released = false;
      const release = coordinator
        .executeUpdate("relinquishJudgeQuota", { args: [] })
        .then(() => {
          released = true;
        });
      await until(async () => (await coordinator.query<State>("admissionState")).paused);
      expect(released).toBe(false);
      resume.resolve();
      await release;
      await restart();
      expect(await coordinator.query<State>("admissionState")).toMatchObject({
        paused: true,
        quotaManaged: false,
        quotaReady: false,
      });
      await env.sleep("31s");
      await until(async () => activities.refreshJudgeCapacity.mock.calls.at(-1)?.[2] === false);
    });
  }, 60_000);

  it("rejects routing before quota ownership and rejects identity substitution", async () => {
    const { activities } = fixtures();
    await withWorkers(activities, async (coordinator) => {
      await coordinator.signal("pauseJudgeAdmission", true);
      await expect(
        coordinator.executeUpdate("configureJudgeDispatch", {
          args: [{ route: "capacity", draining: false }],
        }),
      ).rejects.toThrow();
      await expect(
        coordinator.executeUpdate("dispatchJudgeWorkflow", {
          args: [
            {
              workflowId: "judge-other",
              workflowType: "submissionJudgeWorkflow",
              input: input("wrong"),
            },
          ],
        }),
      ).rejects.toThrow();
    });
  }, 60_000);
});
