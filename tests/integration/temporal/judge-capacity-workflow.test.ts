import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname } from "node:path";

import { ApplicationFailure, type WorkflowHandle } from "@temporalio/client";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { bundleWorkflowCode, Worker, type WorkflowBundle } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { JudgeAdmissionState } from "../../../apps/worker/src/services/judge-capacity";

const coordinatorId = "judge-admission-v1";
const Mi = 1024 ** 2;
let env: TestWorkflowEnvironment;
let workflowBundle: WorkflowBundle;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  workflowBundle = await bundleWorkflowCode({
    workflowsPath: fileURLToPath(
      new URL("../../../apps/worker/src/workflows/index.ts", import.meta.url),
    ),
  });
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

type Activities = Record<string, (...args: unknown[]) => Promise<unknown>>;
interface CoordinatorState {
  admission: JudgeAdmissionState;
  waiters: Record<string, string>;
  outbox: unknown[];
  quarantinedNodes: string[];
  paused: boolean;
}
interface Trace {
  kind: "prepare" | "wave" | "cleanup-stage" | "cleanup-attempt" | "finish";
  runId: string;
  indices?: number[];
}

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function pointer(key: string) {
  return { key, sha256: "a".repeat(64), size: 1 };
}

function fixtures(caseCount: number, overrides: Partial<Activities> = {}) {
  const trace: Trace[] = [];
  const runSubmissions = new Map<string, string>();
  const activities: Activities = {
    startSubmissionJudgeRun: vi.fn(async () => undefined),
    fetchJudgeContext: vi.fn(async (...args: unknown[]) => ({
      staged: true,
      problemType: "full_source",
      userId: `student-${String(args[0])}`,
      createdAt: new Date(1000),
    })),
    failSubmissionJudgeRun: vi.fn(async () => true),
    completeSubmission: vi.fn(async () => null),
    initializeSandboxAttempt: vi.fn(async (...args: unknown[]) => {
      const submissionId = String(args[0]);
      const runId = String(args[2]);
      runSubmissions.set(runId, submissionId);
      return {
        pointer: pointer(`inputs/${runId}`),
        studentId: `student-${submissionId}`,
        mode: "standard",
        terminal: false,
        caseIndices: Array.from({ length: caseCount }, (_, index) => index),
        resources: { cpuMillis: 1000, memoryBytes: 512 * Mi },
        compilerResources: { cpuMillis: 1000, memoryBytes: 512 * Mi },
        overhead: { cpuMillis: 0, memoryBytes: 0 },
      };
    }),
    prepareSandboxAttempt: vi.fn(async (...args: unknown[]) => {
      const runId = String(args[1]);
      trace.push({ kind: "prepare", runId });
      return {
        artifact: {
          runId,
          pvcName: `judge-${runId}-artifact`,
          pvcUid: `pvc-${runId}`,
          nodeName: String(args[2]),
        },
      };
    }),
    executeSandboxWave: vi.fn(async (...args: unknown[]) => {
      const runId = String(args[1]);
      const indices = args[3] as number[];
      trace.push({ kind: "wave", runId, indices });
      return pointer(`results/${runId}/${indices[0]}`);
    }),
    finishSandboxAttempt: vi.fn(async (...args: unknown[]) => {
      trace.push({ kind: "finish", runId: String(args[1]) });
      return {
        result: { accepted: true, verdict: "accepted", score: 100, caseResults: [] },
        advancedJudgeVerificationSnapshot: null,
      };
    }),
    recordAdmissionWait: vi.fn(async () => undefined),
    cleanupSandboxStage: vi.fn(async (...args: unknown[]) => {
      trace.push({ kind: "cleanup-stage", runId: String(args[0]) });
    }),
    cleanupSandboxAttempt: vi.fn(async (...args: unknown[]) => {
      trace.push({ kind: "cleanup-attempt", runId: String(args[0]) });
    }),
    refreshJudgeCapacity: vi.fn(async (...args: unknown[]) => ({
      quotaManaged: args[2] === true,
      capacity: {
        observedAt: await env.currentTimeMs(),
        nodes: [
          {
            name: "node-a",
            eligible: true,
            allocatable: { cpuMillis: 8000, memoryBytes: 24 * 1024 * Mi },
            budget: { cpuMillis: 4000, memoryBytes: 8 * 1024 * Mi },
          },
        ],
      },
      quarantinedNodes: [],
      overhead: { cpuMillis: 0, memoryBytes: 0 },
    })),
    ...overrides,
  };
  return { activities, trace, runSubmissions };
}

async function waitForState(
  coordinator: WorkflowHandle,
  predicate: (state: CoordinatorState) => boolean,
): Promise<CoordinatorState> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const state = await coordinator.query<CoordinatorState>("admissionState");
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Coordinator did not reach the expected state");
}

async function withWorkers(
  activities: Activities,
  body: (context: {
    coordinator: WorkflowHandle;
    startSubmission: (id: string) => Promise<WorkflowHandle>;
    restartCoordinator: (state: CoordinatorState) => Promise<WorkflowHandle>;
  }) => Promise<void>,
): Promise<void> {
  const workers = await Promise.all(
    ["judge-capacity-test", "judge-control"].map((taskQueue) =>
      Worker.create({
        connection: env.nativeConnection,
        taskQueue,
        workflowBundle,
        activities,
        defaultHeartbeatThrottleInterval: "100ms",
        maxHeartbeatThrottleInterval: "100ms",
      }),
    ),
  );
  const submissions: WorkflowHandle[] = [];
  let coordinator: WorkflowHandle | undefined;
  const bodyPromise = (async () => {
    coordinator = await env.client.workflow.start("judgeAdmissionWorkflow", {
      workflowId: coordinatorId,
      taskQueue: "judge-control",
      args: [],
    });
    try {
      await body({
        coordinator,
        startSubmission: async (id) => {
          const handle = await env.client.workflow.start("submissionJudgeWorkflow", {
            workflowId: `capacity-${id}-${String(Date.now())}`,
            taskQueue: "judge-capacity-test",
            args: [
              {
                submissionId: id,
                draft: { problemId: "problem", language: "python", sourceCode: "print(1)" },
              },
            ],
          });
          submissions.push(handle);
          return handle;
        },
        restartCoordinator: async (state) => {
          await coordinator!.terminate("Test restart with serialized durable state");
          coordinator = await env.client.workflow.start("judgeAdmissionWorkflow", {
            workflowId: coordinatorId,
            taskQueue: "judge-control",
            args: [state],
          });
          return coordinator;
        },
      });
    } finally {
      await Promise.allSettled([
        ...submissions.map((handle) => handle.terminate("Test cleanup")),
        coordinator.terminate("Test cleanup"),
      ]);
    }
  })();
  await workers[0]!.runUntil(workers[1]!.runUntil(bodyPromise));
}

describe("capacity judging with real Temporal workflow execution", () => {
  it("holds a timed-out producer permit until verified stop, including cancellation and wrong acknowledgments", async () => {
    const { activities } = fixtures(1);
    const prepare = activities.prepareSandboxAttempt!;
    const started = deferred();
    const producerStopped = deferred();
    let first = true;
    activities.prepareSandboxAttempt = vi.fn(async (...args: unknown[]) => {
      if (first) {
        first = false;
        started.resolve();
        await producerStopped.promise;
      }
      return prepare(...args);
    });
    await withWorkers(activities, async ({ coordinator, startSubmission }) => {
      await coordinator.signal("activateJudgeQuota");
      await coordinator.signal("pauseJudgeAdmission", false);
      const handle = await startSubmission("producer-timeout");
      try {
        await started.promise;
        await handle.signal("confirmJudgeExecutorStopped", {
          runId: "early",
          permitId: "early",
        });
        await env.sleep(61_000);
        type Recovery = {
          runId: string;
          permitId: string;
          timeoutType: string;
          activityType: string;
        };
        let pending: Recovery | null = null;
        for (let attempt = 0; attempt < 200 && !pending; attempt++) {
          pending = await handle.query<Recovery | null>("judgeExecutorRecovery");
          if (!pending) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(pending).toMatchObject({
          timeoutType: "HEARTBEAT",
          activityType: "prepareSandboxAttempt",
        });
        const recovery = pending!;
        await handle.signal("confirmJudgeExecutorStopped", { ...recovery, runId: "wrong-run" });
        await handle.signal("confirmJudgeExecutorStopped", {
          ...recovery,
          permitId: "wrong-permit",
        });
        await handle.cancel();
        expect(await handle.query("judgeExecutorRecovery")).toEqual(recovery);
        expect(activities.cleanupSandboxStage).not.toHaveBeenCalled();
        expect(activities.cleanupSandboxAttempt).not.toHaveBeenCalled();
        const state = await coordinator.query<CoordinatorState>("admissionState");
        expect(
          state.admission.permits.find((permit) => permit.permitId === recovery.permitId)
            ?.cleanupConfirmed,
        ).toBe(false);
        producerStopped.resolve();
        await handle.signal("confirmJudgeExecutorStopped", {
          runId: recovery.runId,
          permitId: recovery.permitId,
        });
        await expect(handle.result()).rejects.toThrow();
        expect(activities.cleanupSandboxStage).toHaveBeenCalledOnce();
        expect(activities.cleanupSandboxAttempt).toHaveBeenCalledOnce();
        expect(activities.prepareSandboxAttempt).toHaveBeenCalledOnce();
      } finally {
        producerStopped.resolve();
      }
    });
  }, 120_000);

  it.each(["initialize", "non-staged"])(
    "requires verified stop before retrying a timed-out %s producer",
    async (phase) => {
      const { activities } = fixtures(1);
      const initialize = activities.initializeSandboxAttempt!;
      let first = true;
      const started = deferred();
      const producerStopped = deferred();
      const result = {
        result: { accepted: true, verdict: "accepted", score: 100, caseResults: [] },
        advancedJudgeVerificationSnapshot: null,
      };
      if (phase === "initialize") {
        activities.initializeSandboxAttempt = vi.fn(async (...args: unknown[]) => {
          if (first) {
            first = false;
            started.resolve();
            await producerStopped.promise;
          }
          return initialize(...args);
        });
      } else {
        activities.fetchJudgeContext = vi.fn(async () => ({
          staged: false,
          problemType: "full_source",
          userId: "student",
          createdAt: new Date(1000),
        }));
        activities.executeSandbox = vi.fn(async () => {
          if (first) {
            first = false;
            started.resolve();
            await producerStopped.promise;
          }
          return result;
        });
        activities.cleanupSandboxRun = vi.fn(async () => undefined);
      }
      await withWorkers(activities, async ({ coordinator, startSubmission }) => {
        await coordinator.signal("activateJudgeQuota");
        await coordinator.signal("pauseJudgeAdmission", false);
        const handle = await startSubmission(`timeout-${phase}`);
        try {
          await started.promise;
          await env.sleep(phase === "initialize" ? 121_000 : 61_000);
          type Recovery = { runId: string; permitId: string };
          let pending: Recovery | null = null;
          for (let attempt = 0; attempt < 200 && !pending; attempt++) {
            pending = await handle.query<Recovery | null>("judgeExecutorRecovery");
            if (!pending) await new Promise((resolve) => setTimeout(resolve, 10));
          }
          expect(pending).not.toBeNull();
          const recovery = pending!;
          expect(recovery.permitId).toBe(
            `${recovery.runId}/${phase === "initialize" ? "initialize" : "sandbox"}`,
          );
          const producer =
            phase === "initialize"
              ? activities.initializeSandboxAttempt!
              : activities.executeSandbox!;
          expect(producer).toHaveBeenCalledOnce();
          expect(activities.cleanupSandboxAttempt).not.toHaveBeenCalled();
          if (phase === "non-staged")
            expect(activities.cleanupSandboxRun).not.toHaveBeenCalled();
          producerStopped.resolve();
          await handle.signal("confirmJudgeExecutorStopped", {
            runId: recovery.runId,
            permitId: recovery.permitId,
          });
          await handle.result();
          expect(producer).toHaveBeenCalledTimes(2);
          expect(activities.completeSubmission).toHaveBeenCalledOnce();
        } finally {
          producerStopped.resolve();
        }
      });
    },
    180_000,
  );

  it("replays a pre-patch two-argument sandbox history with the production workflow bundle", async () => {
    const workerRequire = createRequire(
      new URL("../../../apps/worker/package.json", import.meta.url),
    );
    const legacyBundle = await bundleWorkflowCode({
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
    const { activities } = fixtures(20, {
      fetchJudgeContext: vi.fn(async () => ({ problemType: "full_source" })),
      executeSandbox: vi.fn(async () => ({
        result: { accepted: true, verdict: "accepted", score: 100, caseResults: [] },
        advancedJudgeVerificationSnapshot: null,
      })),
    });
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: "judge-legacy-replay",
      workflowBundle: legacyBundle,
      activities,
    });
    await worker.runUntil(async () => {
      const handle = await env.client.workflow.start("submissionJudgeWorkflow", {
        workflowId: `legacy-capacity-replay-${Date.now()}`,
        taskQueue: "judge-legacy-replay",
        args: [
          {
            submissionId: "legacy",
            draft: { problemId: "problem", language: "python", sourceCode: "print(1)" },
          },
        ],
      });
      await handle.result();
      expect(activities.executeSandbox).toHaveBeenCalledWith(
        "legacy",
        expect.objectContaining({ language: "python" }),
      );
      const history = await handle.fetchHistory();
      await Worker.runReplayHistory({ workflowBundle }, history);
    });
  }, 60_000);

  it("does not start another attempt for a typed non-retryable sandbox admission failure", async () => {
    const { activities } = fixtures(20, {
      prepareSandboxAttempt: vi.fn(async () => {
        throw ApplicationFailure.create({
          message: "Requested memory exceeds node capacity",
          type: "SandboxAdmissionError",
        });
      }),
    });
    await withWorkers(activities, async ({ coordinator, startSubmission }) => {
      await coordinator.signal("activateJudgeQuota");
      await coordinator.signal("pauseJudgeAdmission", false);
      const handle = await startSubmission("terminal-admission");
      await expect(handle.result()).rejects.toThrow();
    });
    expect(activities.prepareSandboxAttempt).toHaveBeenCalledOnce();
    expect(activities.initializeSandboxAttempt).toHaveBeenCalledOnce();
    expect(activities.failSubmissionJudgeRun).toHaveBeenCalledOnce();
    expect(activities.cleanupSandboxAttempt).toHaveBeenCalledOnce();
  }, 60_000);

  it("cleans a lost artifact attempt and retries with a fresh run ID", async () => {
    const { activities } = fixtures(20);
    const prepare = activities.prepareSandboxAttempt!;
    let loseArtifact = true;
    activities.prepareSandboxAttempt = vi.fn(async (...args: unknown[]) => {
      if (loseArtifact) {
        loseArtifact = false;
        throw new Error("artifact_node_unavailable");
      }
      return prepare(...args);
    });
    await withWorkers(activities, async ({ coordinator, startSubmission }) => {
      await coordinator.signal("activateJudgeQuota");
      await coordinator.signal("pauseJudgeAdmission", false);
      const handle = await startSubmission("artifact-retry");
      await handle.result();
    });
    const attempts = vi
      .mocked(activities.prepareSandboxAttempt!)
      .mock.calls.map((args) => args[1]);
    expect(attempts).toHaveLength(2);
    expect(new Set(attempts).size).toBe(2);
    expect(activities.cleanupSandboxAttempt).toHaveBeenCalledTimes(2);
    expect(activities.completeSubmission).toHaveBeenCalledOnce();
  }, 60_000);

  it("keeps admission closed until an explicit, successful quota handoff", async () => {
    const { activities } = fixtures(1);
    await withWorkers(activities, async ({ coordinator, startSubmission }) => {
      await coordinator.signal("pauseJudgeAdmission", false);
      const handle = await startSubmission("quota-handoff");
      await waitForState(coordinator, (state) => state.admission.pending.length === 1);
      expect(activities.prepareSandboxAttempt).not.toHaveBeenCalled();
      expect(
        vi
          .mocked(activities.refreshJudgeCapacity!)
          .mock.calls.every((args) => args[2] === false),
      ).toBe(true);
      await coordinator.signal("activateJudgeQuota");
      await handle.result();
      expect(
        vi.mocked(activities.refreshJudgeCapacity!).mock.calls.some((args) => args[2] === true),
      ).toBe(true);
      expect(activities.prepareSandboxAttempt).toHaveBeenCalledTimes(1);
    });
  });

  it.each([20, 100])(
    "compiles once and completes all %i cases in isolated bounded waves",
    async (caseCount) => {
      const { activities, trace } = fixtures(caseCount);
      await withWorkers(activities, async ({ coordinator, startSubmission }) => {
        await coordinator.signal("activateJudgeQuota");
        await coordinator.signal("pauseJudgeAdmission", false);
        const handle = await startSubmission(`cases-${caseCount}`);
        await handle.result();
        const state = await coordinator.query<CoordinatorState>("admissionState");
        expect(state.admission.permits.filter((permit) => !permit.cleanupConfirmed)).toEqual(
          [],
        );
      });
      expect(activities.prepareSandboxAttempt).toHaveBeenCalledTimes(1);
      expect(activities.executeSandboxWave).toHaveBeenCalledTimes(caseCount / 4);
      const waves = trace.filter((entry) => entry.kind === "wave");
      expect(waves.flatMap((entry) => entry.indices)).toEqual(
        Array.from({ length: caseCount }, (_, index) => index),
      );
      expect(waves.every((wave) => wave.indices!.length <= 4)).toBe(true);
      for (let index = 0; index < trace.length; index++) {
        if (trace[index]!.kind === "prepare" || trace[index]!.kind === "wave")
          expect(trace[index + 1]!.kind).toBe("cleanup-stage");
      }
      expect(activities.completeSubmission).toHaveBeenCalledTimes(1);
      expect(activities.failSubmissionJudgeRun).not.toHaveBeenCalled();
    },
    60_000,
  );

  it("durably retries cleanup while retaining its permit and preventing the next wave", async () => {
    const firstFailure = deferred();
    const { activities, trace } = fixtures(20);
    const cleanup = activities.cleanupSandboxStage!;
    let failOnce = true;
    activities.cleanupSandboxStage = vi.fn(async (...args: unknown[]) => {
      if (failOnce) {
        failOnce = false;
        firstFailure.resolve();
        throw new Error("cleanup_pending: Pod UID still terminating");
      }
      return cleanup(...args);
    });
    await withWorkers(activities, async ({ coordinator, startSubmission }) => {
      await coordinator.signal("activateJudgeQuota");
      await coordinator.signal("pauseJudgeAdmission", false);
      const handle = await startSubmission("cleanup-retry");
      await firstFailure.promise;
      const state = await coordinator.query<CoordinatorState>("admissionState");
      expect(state.admission.permits.filter((permit) => !permit.cleanupConfirmed)).toHaveLength(
        1,
      );
      expect(activities.executeSandboxWave).not.toHaveBeenCalled();
      await handle.result();
    });
    expect(activities.prepareSandboxAttempt).toHaveBeenCalledTimes(1);
    expect(activities.cleanupSandboxStage).toHaveBeenCalledTimes(7);
    expect(trace.filter((entry) => entry.kind === "wave")).toHaveLength(5);
    expect(activities.completeSubmission).toHaveBeenCalledOnce();
  }, 60_000);

  it("cancels a queued submission without starting sandbox execution", async () => {
    const { activities } = fixtures(20);
    await withWorkers(activities, async ({ coordinator, startSubmission }) => {
      const handle = await startSubmission("cancel-queued");
      await waitForState(coordinator, (state) => state.admission.pending.length === 1);
      await handle.cancel();
      await expect(handle.result()).rejects.toThrow();
      const state = await coordinator.query<CoordinatorState>("admissionState");
      expect(state.admission.pending).toEqual([]);
      expect(state.admission.permits).toEqual([]);
      expect(state.admission.cancelledRunIds).toHaveLength(1);
    });
    expect(activities.prepareSandboxAttempt).not.toHaveBeenCalled();
    expect(activities.executeSandboxWave).not.toHaveBeenCalled();
    expect(activities.cleanupSandboxAttempt).toHaveBeenCalledTimes(1);
  }, 60_000);

  it("restores serialized coordinator state without dropping an active permit or recompiling", async () => {
    const preparing = deferred();
    const resume = deferred();
    const { activities } = fixtures(20);
    const prepare = activities.prepareSandboxAttempt!;
    activities.prepareSandboxAttempt = vi.fn(async (...args: unknown[]) => {
      preparing.resolve();
      await resume.promise;
      return prepare(...args);
    });
    await withWorkers(
      activities,
      async ({ coordinator, startSubmission, restartCoordinator }) => {
        await coordinator.signal("activateJudgeQuota");
        await coordinator.signal("pauseJudgeAdmission", false);
        const handle = await startSubmission("coordinator-restart");
        await preparing.promise;
        const snapshot = await coordinator.query<CoordinatorState>("admissionState");
        const held = snapshot.admission.permits.filter((permit) => !permit.cleanupConfirmed);
        expect(held).toHaveLength(1);
        const restarted = await restartCoordinator(
          JSON.parse(JSON.stringify(snapshot)) as CoordinatorState,
        );
        const restored = await restarted.query<CoordinatorState>("admissionState");
        expect(restored.admission.permits.filter((permit) => !permit.cleanupConfirmed)).toEqual(
          held,
        );
        resume.resolve();
        await handle.result();
      },
    );
    expect(activities.prepareSandboxAttempt).toHaveBeenCalledTimes(1);
    expect(activities.executeSandboxWave).toHaveBeenCalledTimes(5);
    expect(activities.completeSubmission).toHaveBeenCalledTimes(1);
  }, 60_000);

  it("registers before slow initialization so a later submission from that student cannot overtake", async () => {
    const firstInitializing = deferred();
    const allowFirst = deferred();
    const { activities, trace, runSubmissions } = fixtures(20);
    const initialize = activities.initializeSandboxAttempt!;
    activities.fetchJudgeContext = vi.fn(async (...args: unknown[]) => ({
      staged: true,
      problemType: "full_source",
      userId: "same-student",
      createdAt: new Date(args[0] === "older" ? 1000 : 2000),
    }));
    activities.initializeSandboxAttempt = vi.fn(async (...args: unknown[]) => {
      if (args[0] === "older") {
        firstInitializing.resolve();
        await allowFirst.promise;
      }
      return { ...((await initialize(...args)) as object), studentId: "same-student" };
    });
    await withWorkers(activities, async ({ coordinator, startSubmission }) => {
      await coordinator.signal("activateJudgeQuota");
      await coordinator.signal("pauseJudgeAdmission", false);
      const first = await startSubmission("older");
      await firstInitializing.promise;
      const registered = await coordinator.query<CoordinatorState>("admissionState");
      expect(registered.admission.runs).toHaveLength(1);
      expect(registered.admission.pending).toEqual([]);
      const second = await startSubmission("newer");
      await waitForState(coordinator, (state) => state.admission.pending.length === 1);
      expect(activities.prepareSandboxAttempt).not.toHaveBeenCalled();
      allowFirst.resolve();
      await Promise.all([first.result(), second.result()]);
    });
    const prepares = trace.filter((entry) => entry.kind === "prepare");
    expect(prepares.map((entry) => runSubmissions.get(entry.runId))).toEqual([
      "older",
      "newer",
    ]);
    const newerPrepare = trace.indexOf(prepares[1]!);
    const olderCleanup = trace.findIndex(
      (entry) => entry.kind === "cleanup-attempt" && entry.runId === prepares[0]!.runId,
    );
    expect(newerPrepare).toBeGreaterThan(olderCleanup);
    expect(activities.completeSubmission).toHaveBeenCalledTimes(2);
  }, 60_000);
  it("retains a student's FIFO position across failed-attempt cleanup and retry", async () => {
    const { activities, runSubmissions } = fixtures(1);
    const initialize = activities.initializeSandboxAttempt!;
    const prepare = activities.prepareSandboxAttempt!;
    const firstPreparing = deferred();
    const failFirst = deferred();
    const attempts: string[] = [];
    let failOlder = true;
    activities.fetchJudgeContext = vi.fn(async (...args: unknown[]) => ({
      staged: true,
      problemType: "full_source",
      userId: "same-student",
      createdAt: new Date(args[0] === "older" ? 1000 : 2000),
    }));
    activities.initializeSandboxAttempt = vi.fn(async (...args: unknown[]) => ({
      ...((await initialize(...args)) as object),
      studentId: "same-student",
    }));
    activities.prepareSandboxAttempt = vi.fn(async (...args: unknown[]) => {
      const submission = runSubmissions.get(String(args[1]))!;
      attempts.push(submission);
      if (submission === "older" && failOlder) {
        failOlder = false;
        firstPreparing.resolve();
        await failFirst.promise;
        throw new Error("Temporary artifact failure");
      }
      return prepare(...args);
    });
    await withWorkers(activities, async ({ coordinator, startSubmission }) => {
      await coordinator.signal("activateJudgeQuota");
      await coordinator.signal("pauseJudgeAdmission", false);
      const first = await startSubmission("older");
      try {
        await firstPreparing.promise;
        const second = await startSubmission("newer");
        await waitForState(coordinator, (state) =>
          state.admission.pending.some(
            (request) => runSubmissions.get(request.runId) === "newer",
          ),
        );
        failFirst.resolve();
        await vi.waitFor(() => expect(activities.completeSubmission).toHaveBeenCalledTimes(2), {
          timeout: 10_000,
        });
        await Promise.all([first.result(), second.result()]);
      } finally {
        failFirst.resolve();
      }
    });
    expect(attempts).toEqual(["older", "older", "newer"]);
    expect(activities.cleanupSandboxAttempt).toHaveBeenCalledTimes(3);
    expect(activities.completeSubmission).toHaveBeenCalledTimes(2);
  }, 60_000);
});
