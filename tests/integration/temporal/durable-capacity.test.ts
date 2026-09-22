import { fileURLToPath } from "node:url";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { ApplicationFailure } from "@temporalio/activity";
import { Worker, bundleWorkflowCode, type WorkflowBundle } from "@temporalio/worker";
import type { WorkflowHandle } from "@temporalio/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createAdmissionState,
  registerAdmissionRun,
  type JudgeAdmissionState,
} from "../../../apps/worker/src/services/judge-capacity";

let env: TestWorkflowEnvironment;
let bundle: WorkflowBundle;
interface Coordinator {
  admission: JudgeAdmissionState;
  activeSubmissionIds: string[];
  quotaReady: boolean;
  runOwners: Record<string, string>;
  fullCleanupConfirmed: string[];
  fifoWaiters?: Record<
    string,
    {
      requestId: string;
      executionId: string;
      workflowId: string;
      check: number;
      notified: boolean;
    }
  >;
}
interface Execution {
  state: string;
  leaseToken: string | null;
  indices: number[];
  stages: number;
  capacity: boolean;
  studentId?: string;
  workflowId?: string;
}
const executions = new Map<string, Execution>();
const runExecutions = new Map<string, string>();
const pointer = (key: string) => ({ key, sha256: "a".repeat(64), size: 1 });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 500; i++) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error("Workflow state did not converge");
}
beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  bundle = await bundleWorkflowCode({
    workflowsPath: fileURLToPath(
      new URL("../../../apps/worker/src/workflows/index.ts", import.meta.url),
    ),
  });
}, 120_000);
afterAll(async () => {
  await env?.teardown();
});
function fixtures(cases = 9, cpuBudget = 4000) {
  const judgeExecutionTurn = vi.fn(async (executionId: string): Promise<string> => {
    const state = await env.client.workflow
      .getHandle("judge-admission-v1")
      .query<{ dispatchRoute: string; draining: boolean; active: boolean }, [string]>(
        "judgeDispatchState",
        executionId,
      );
    return state.draining && state.dispatchRoute === "legacy" && !state.active
      ? "redirect"
      : "ready";
  });
  const activities = {
    judgeExecutionTurn,
    resolveJudgeFifoWaiters: vi.fn(
      async (waiters: { executionId: string; workflowId: string }[]) => {
        const decisions = await Promise.all(
          waiters.map(async (waiter) => ({
            ...waiter,
            outcome: await judgeExecutionTurn.getMockImplementation()!(waiter.executionId),
          })),
        );
        return decisions.filter(({ outcome }) => outcome !== "wait");
      },
    ),
    findPriorCapacityRuns: vi.fn(async (executionId: string, workflowId: string) => {
      const state = await env.client.workflow
        .getHandle("judge-admission-v1")
        .query<Coordinator>("admissionState");
      return state.admission.runs
        .filter(
          (run) =>
            !run.finished &&
            run.orderKey === executionId &&
            state.runOwners[run.runId] &&
            state.runOwners[run.runId] !== workflowId,
        )
        .map((run) => ({
          runId: run.runId,
          ownerWorkflowId: state.runOwners[run.runId],
          cleanupConfirmed: state.fullCleanupConfirmed.includes(run.runId),
        }));
    }),
    judgeExecutionStatus: vi.fn(async (id: string) => {
      const row = executions.get(id)!;
      return {
        state: row.state,
        leaseToken: row.leaseToken,
        stage: row.stages,
        reasonCode: null,
        attempt: 0,
      };
    }),
    setJudgeExecutionState: vi.fn(async (id: string, _workflow: string, state: string) => {
      const row = executions.get(id)!;
      if (row.state !== "finalizing") row.state = state;
      return true;
    }),
    initializePinnedSandboxAttempt: vi.fn(
      async (id: string, _workflow: string, runId: string) => {
        runExecutions.set(runId, id);
        const row = executions.get(id)!;
        return {
          obsolete: false,
          pointer: pointer(id),
          studentId: row.studentId ?? id,
          submittedAt: 1000,
          mode: "standard",
          terminal: false,
          caseIndices: Array.from({ length: cases }, (_, index) => index),
          compilerResources: { cpuMillis: 1000, memoryBytes: 1024 },
          resources: { cpuMillis: 1000, memoryBytes: 1024 },
          overhead: { cpuMillis: 0, memoryBytes: 0 },
          checkpointCount: row.stages,
          completedIndices: [...row.indices],
          priorLease: row.leaseToken,
        };
      },
    ),
    claimPinnedCapacityAttempt: vi.fn(async (id: string, _workflow: string, runId: string) => {
      const row = executions.get(id)!;
      if (row.workflowId !== _workflow) return { status: "obsolete", leaseToken: runId };
      row.leaseToken = runId;
      row.capacity = true;
      return { status: "claimed", leaseToken: runId };
    }),
    heartbeatPinnedCapacityAttempt: vi.fn(
      async (id: string, _workflow: string, runId: string) =>
        executions.get(id)?.leaseToken === runId,
    ),
    releasePinnedCapacityAttempt: vi.fn(
      async (id: string, _workflow: string, runId: string) => {
        const row = executions.get(id)!;
        if (row.leaseToken === runId) row.leaseToken = null;
      },
    ),
    relinquishPinnedCapacityStrategy: vi.fn(async (id: string) => {
      const row = executions.get(id)!;
      if (row.leaseToken || row.stages) throw new Error("Unsafe rollback");
      row.capacity = false;
    }),
    prepareSandboxAttempt: vi.fn(
      async (_pointer: unknown, runId: string, nodeName: string) => ({
        artifact: { runId, pvcName: runId, pvcUid: runId, nodeName },
      }),
    ),
    executePinnedSandboxWave: vi.fn(
      async (
        _pointer: unknown,
        runId: string,
        _node: string,
        indices: number[],
        checkpoint: number,
      ) => {
        const row = executions.get(runExecutions.get(runId)!)!;
        expect(row.leaseToken).toBe(runId);
        expect(checkpoint).toBe(row.stages);
        row.indices.push(...indices);
        row.stages++;
      },
    ),
    finishPinnedSandboxAttempt: vi.fn(async (_pointer: unknown, runId: string) => {
      const row = executions.get(runExecutions.get(runId)!)!;
      expect(row.leaseToken).toBe(runId);
      row.stages++;
      row.state = "finalizing";
    }),
    recordAdmissionWait: vi.fn(async () => undefined),
    cleanupSandboxStage: vi.fn(async () => undefined),
    cleanupSandboxAttempt: vi.fn(async () => undefined),
    completePinnedJudge: vi.fn(async () => null),
    finishJudgeExecution: vi.fn(async (id: string) => {
      executions.get(id)!.state = "completed";
    }),
    closedJudgeWorkflows: vi.fn(async () => []),
    executeJudgeStage: vi.fn(async () => ({ status: "finished" })),
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
              allocatable: { cpuMillis: 8000, memoryBytes: 100_000 },
              budget: { cpuMillis: cpuBudget, memoryBytes: 75_000 },
            },
          ],
        },
      }),
    ),
  };
  return activities;
}
async function withWorkers(
  activities: ReturnType<typeof fixtures>,
  body: (
    coordinator: WorkflowHandle,
    start: (id: string, prior?: Partial<Execution>, epoch?: number) => Promise<WorkflowHandle>,
    restart: () => Promise<void>,
  ) => Promise<void>,
) {
  executions.clear();
  runExecutions.clear();
  let control = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: "judge-control",
    workflowBundle: bundle,
    maxCachedWorkflows: 0,
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
  const handles: WorkflowHandle[] = [];
  const coordinator = await env.client.workflow.start("judgeAdmissionWorkflow", {
    workflowId: "judge-admission-v1",
    taskQueue: "judge-control",
    args: [],
  });
  try {
    await coordinator.signal("activateJudgeQuota");
    await coordinator.signal("pauseJudgeAdmission", false);
    await until(
      async () => (await coordinator.query<Coordinator>("admissionState")).quotaReady,
    );
    await coordinator.executeUpdate("configureJudgeDispatch", {
      args: [{ route: "capacity", draining: false }],
    });
    await body(
      coordinator,
      async (id, prior = {}, epoch = 0) => {
        const workflowId = `judge-execution-${id}-${String(epoch)}`;
        const row = {
          state: "queued",
          leaseToken: null,
          indices: [],
          stages: 0,
          capacity: false,
          ...prior,
          workflowId,
        };
        executions.set(id, row);
        await coordinator.executeUpdate("dispatchJudgeWorkflow", {
          args: [
            {
              workflowId,
              workflowType: "durableJudgeWorkflow",
              input: { executionId: id, ...(row.capacity ? { capacity: true } : {}) },
              admissionOrder: {
                executionId: id,
                submissionId: `submission-${id}`,
                studentId: row.studentId ?? id,
                submittedAt: 1000,
              },
            },
          ],
        });
        const handle = env.client.workflow.getHandle(workflowId);
        handles.push(handle);
        return handle;
      },
      async () => {
        control.shutdown();
        await controlRun;
        control = await Worker.create({
          connection: env.nativeConnection,
          taskQueue: "judge-control",
          workflowBundle: bundle,
          maxCachedWorkflows: 0,
          activities,
        });
        controlRun = control.run();
      },
    );
  } finally {
    await Promise.allSettled(handles.map((handle) => handle.terminate("Test cleanup")));
    await coordinator.terminate("Test cleanup").catch(() => undefined);
    control.shutdown();
    judge.shutdown();
    await Promise.all([controlRun, judgeRun]);
  }
}
describe("durable pinned capacity pipeline", () => {
  it("returns only execution-specific routing state when the coordinator has a large backlog", async () => {
    const admission = createAdmissionState();
    for (let index = 0; index < 800; index++) {
      registerAdmissionRun(
        admission,
        {
          runId: `queued-run-${String(index)}`,
          submissionId: `execution-${String(index)}`,
          studentId: `student-${String(index)}`,
          submittedAt: 1000,
          createdAt: 1000,
        },
        1000,
      );
    }
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: "judge-control",
      workflowBundle: bundle,
      activities: fixtures(),
    });
    await worker.runUntil(async () => {
      const coordinator = await env.client.workflow.start("judgeAdmissionWorkflow", {
        workflowId: "judge-routing-projection",
        taskQueue: "judge-control",
        args: [
          {
            admission,
            waiters: {},
            runOwners: {},
            fullCleanupConfirmed: [],
            outbox: [],
            quarantinedNodes: [],
            paused: true,
            quotaManaged: false,
            quotaReady: false,
            draining: false,
            dispatchRoute: "capacity",
            activeSubmissionIds: ["execution-799"],
            stagedWorkflowIds: [],
            routingInFlight: 0,
          },
        ],
      });
      try {
        expect(await coordinator.query("judgeDispatchState", "execution-799")).toEqual({
          dispatchRoute: "capacity",
          draining: false,
          active: true,
        });
        expect(await coordinator.query("judgeDispatchState", "execution-0")).toEqual({
          dispatchRoute: "capacity",
          draining: false,
          active: false,
        });
        await coordinator.executeUpdate("configureJudgeDispatch", {
          args: [{ route: "legacy", draining: true }],
        });
        expect(await coordinator.query("judgeDispatchState", "execution-799")).toEqual({
          dispatchRoute: "legacy",
          draining: true,
          active: true,
        });
        expect(await coordinator.query("judgeDispatchState", "execution-0")).toEqual({
          dispatchRoute: "legacy",
          draining: true,
          active: false,
        });
        expect(
          (await coordinator.query<Coordinator>("admissionState")).admission.runs,
        ).toHaveLength(800);
      } finally {
        await coordinator.terminate("Test cleanup");
      }
    });
  }, 30_000);
  it("recovers from five quota rejections without exhausting retries or losing saved cases", async () => {
    const activities = fixtures(20, 6000);
    const execute = activities.executePinnedSandboxWave.getMockImplementation()!;
    let failures = 0;
    activities.executePinnedSandboxWave.mockImplementation(async (...args) => {
      if (args[3][0] === 6 && failures++ < 5)
        throw ApplicationFailure.create({
          type: "SandboxBackpressureError",
          message: "forbidden: exceeded quota: sandbox-quota",
        });
      return execute(...args);
    });
    await withWorkers(activities, async (_coordinator, start) => {
      await (await start("quota-recovery")).result();
      expect(
        activities.setJudgeExecutionState.mock.calls.filter(
          (call) => call[2] === "waiting_capacity",
        ),
      ).toHaveLength(5);
      expect(
        activities.setJudgeExecutionState.mock.calls.some((call) =>
          ["blocked", "recovering"].includes(call[2]),
        ),
      ).toBe(false);
      expect(
        activities.executePinnedSandboxWave.mock.calls.filter((call) => call[3].includes(0)),
      ).toHaveLength(1);
      expect(executions.get("quota-recovery")).toMatchObject({
        state: "completed",
        leaseToken: null,
        indices: Array.from({ length: 20 }, (_, index) => index),
      });
    });
  }, 60_000);
  it("waits through prolonged capacity exhaustion and a controller restart, then resumes without SE", async () => {
    const activities = fixtures(20, 6000);
    const refresh = activities.refreshJudgeCapacity.getMockImplementation()!;
    let recoveryAt = Number.POSITIVE_INFINITY;
    let queuedRefreshes = 0;
    activities.refreshJudgeCapacity.mockImplementation(async (...args) => {
      const snapshot = await refresh(...args);
      if (snapshot.capacity.observedAt < recoveryAt) {
        snapshot.capacity.nodes[0]!.budget.cpuMillis = 0;
        queuedRefreshes++;
        expect(activities.prepareSandboxAttempt).not.toHaveBeenCalled();
        expect(activities.executePinnedSandboxWave).not.toHaveBeenCalled();
      }
      return snapshot;
    });
    await withWorkers(activities, async (coordinator, start, restart) => {
      const handle = await start("capacity-exhausted");
      await until(
        async () =>
          (await coordinator.query<Coordinator>("admissionState")).admission.pending.length > 0,
      );
      await restart();
      expect((await handle.describe()).status.name).toBe("RUNNING");
      recoveryAt = (await env.currentTimeMs()) + 120_000;
      await env.sleep("150s");
      await handle.result();
      expect(queuedRefreshes).toBeGreaterThanOrEqual(4);
      expect(
        activities.setJudgeExecutionState.mock.calls.some((call) =>
          ["blocked", "recovering"].includes(call[2]),
        ),
      ).toBe(false);
      expect(activities.prepareSandboxAttempt).toHaveBeenCalledOnce();
      expect(executions.get("capacity-exhausted")).toMatchObject({
        state: "completed",
        indices: Array.from({ length: 20 }, (_, index) => index),
      });
    });
  }, 180_000);
  it.each([1, 20, 100])(
    "compiles once and checkpoints %i cases in bounded waves",
    async (cases) => {
      const activities = fixtures(cases, 6000);
      await withWorkers(activities, async (_coordinator, start) => {
        const handle = await start(`cases-${cases}`);
        await handle.result();
        expect(activities.prepareSandboxAttempt).toHaveBeenCalledOnce();
        expect(activities.executePinnedSandboxWave).toHaveBeenCalledTimes(Math.ceil(cases / 6));
        expect(activities.executePinnedSandboxWave.mock.calls[0]![3]).toHaveLength(
          Math.min(cases, 6),
        );
        expect(executions.get(`cases-${cases}`)).toMatchObject({
          state: "completed",
          leaseToken: null,
          indices: Array.from({ length: cases }, (_, index) => index),
        });
        expect(activities.executeJudgeStage).not.toHaveBeenCalled();
      });
    },
    60_000,
  );
  it("preserves saved waves through an attempt failure without re-executing them", async () => {
    const activities = fixtures();
    const execute = activities.executePinnedSandboxWave.getMockImplementation()!;
    let fail = true;
    activities.executePinnedSandboxWave.mockImplementation(async (...args) => {
      if (args[4] === 1 && fail) {
        fail = false;
        throw new Error("Node unavailable");
      }
      return execute(...args);
    });
    await withWorkers(activities, async (_coordinator, start) => {
      await (await start("checkpoint-retry")).result();
      expect(activities.prepareSandboxAttempt).toHaveBeenCalledTimes(2);
      expect(executions.get("checkpoint-retry")?.indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
      expect(
        activities.executePinnedSandboxWave.mock.calls.filter((call) => call[3].includes(0)),
      ).toHaveLength(1);
    });
  }, 60_000);
  it("drains active submissions across a coordinator restart and prepare retry", async () => {
    const activities = fixtures();
    const entered = deferred();
    const resume = deferred();
    const prepare = activities.prepareSandboxAttempt.getMockImplementation()!;
    let fail = true;
    activities.prepareSandboxAttempt.mockImplementation(async (...args) => {
      if (fail) {
        fail = false;
        entered.resolve();
        await resume.promise;
        throw new Error("Retry prepare");
      }
      return prepare(...args);
    });
    await withWorkers(activities, async (coordinator, start, restart) => {
      const handle = await start("draining");
      await entered.promise;
      await coordinator.executeUpdate("configureJudgeDispatch", {
        args: [{ route: "legacy", draining: true }],
      });
      await restart();
      resume.resolve();
      await handle.result();
      expect(activities.prepareSandboxAttempt).toHaveBeenCalledTimes(2);
      expect(activities.executeJudgeStage).not.toHaveBeenCalled();
    });
  }, 60_000);
  it("requires producer-stop proof and keeps checkpointed recovery on candidate during rollback", async () => {
    const activities = fixtures();
    const oldLease = "01234567-1234-1234-1234-123456789abc";
    await withWorkers(activities, async (coordinator, start) => {
      await coordinator.executeUpdate("configureJudgeDispatch", {
        args: [{ route: "legacy", draining: true }],
      });
      const handle = await start("recovery-epoch", {
        capacity: true,
        stages: 1,
        indices: [0, 1, 2, 3],
        leaseToken: oldLease,
      });
      await until(async () =>
        Boolean(await handle.query("judgeExecutorRecovery").catch(() => null)),
      );
      expect((await handle.describe()).taskQueue).toBe("judge-capacity-v1");
      expect(activities.cleanupSandboxAttempt).not.toHaveBeenCalled();
      await handle.signal("confirmJudgeExecutorStopped", {
        runId: oldLease,
        permitId: `${oldLease}/recovery`,
      });
      await handle.result();
      expect(executions.get("recovery-epoch")?.indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
      expect(
        activities.executePinnedSandboxWave.mock.calls.every((call) => !call[3].includes(0)),
      ).toBe(true);
    });
  }, 60_000);
  it("redirects only untouched executions to a fresh default durable workflow", async () => {
    const activities = fixtures();
    await withWorkers(activities, async (coordinator, start) => {
      await coordinator.signal("pauseJudgeAdmission", true);
      const handle = await start("untouched");
      await until(
        async () =>
          (await coordinator.query<Coordinator>("admissionState")).admission.pending.length ===
          1,
      );
      await coordinator.executeUpdate("configureJudgeDispatch", {
        args: [{ route: "legacy", draining: true }],
      });
      await coordinator.signal("pauseJudgeAdmission", false);
      await until(async () => (await handle.describe()).taskQueue === "judge");
      const current = await handle.describe();
      const history = await env.client.workflow
        .getHandle(handle.workflowId, current.runId)
        .fetchHistory();
      expect(history.events?.some((event) => event.workflowTaskStartedEventAttributes)).toBe(
        false,
      );
      expect(activities.relinquishPinnedCapacityStrategy).toHaveBeenCalledOnce();
      expect(activities.prepareSandboxAttempt).not.toHaveBeenCalled();
      const old = await Worker.create({
        connection: env.nativeConnection,
        taskQueue: "judge",
        workflowBundle: bundle,
        activities,
      });
      await old.runUntil(handle.result());
      expect(activities.executeJudgeStage).toHaveBeenCalledOnce();
    });
  }, 60_000);
  it("keeps slow initialization FIFO and deduplicates accepted dispatch", async () => {
    const activities = fixtures(1);
    const initialized = deferred();
    const resume = deferred();
    const initialize = activities.initializePinnedSandboxAttempt.getMockImplementation()!;
    activities.initializePinnedSandboxAttempt.mockImplementation(async (...args) => {
      if (args[0] === "fifo-first") {
        initialized.resolve();
        await resume.promise;
      }
      return initialize(...args);
    });
    await withWorkers(activities, async (coordinator, start) => {
      const first = await start("fifo-first", { studentId: "same-student" });
      await initialized.promise;
      const second = await start("fifo-second", { studentId: "same-student" });
      await until(
        async () =>
          (await coordinator.query<Coordinator>("admissionState")).admission.pending.length ===
          1,
      );
      expect(activities.prepareSandboxAttempt).not.toHaveBeenCalled();
      await coordinator.executeUpdate("dispatchJudgeWorkflow", {
        args: [
          {
            workflowId: first.workflowId,
            workflowType: "durableJudgeWorkflow",
            input: { executionId: "fifo-first" },
            admissionOrder: {
              executionId: "fifo-first",
              studentId: "same-student",
              submittedAt: 1000,
            },
          },
        ],
      });
      resume.resolve();
      await Promise.all([first.result(), second.result()]);
      expect(
        activities.prepareSandboxAttempt.mock.calls.map(
          ([ref]) => (ref as { key: string }).key,
        ),
      ).toEqual(["fifo-first", "fifo-second"]);
      expect(activities.initializePinnedSandboxAttempt).toHaveBeenCalledTimes(2);
    });
  }, 60_000);
  it("holds accepted work across restart and cancels queued work without a sandbox", async () => {
    const activities = fixtures(1);
    await withWorkers(activities, async (coordinator, start, restart) => {
      await coordinator.signal("pauseJudgeAdmission", true);
      await coordinator.executeUpdate("configureJudgeDispatch", {
        args: [{ route: "hold", draining: true }],
      });
      const handle = await start("held-cancel");
      await until(
        async () =>
          (await coordinator.query<Coordinator>("admissionState")).admission.pending.length ===
          1,
      );
      await restart();
      expect(activities.prepareSandboxAttempt).not.toHaveBeenCalled();
      await handle.cancel();
      await expect(handle.result()).rejects.toThrow();
      await until(
        async () =>
          (await coordinator.query<Coordinator>("admissionState")).admission.pending.length ===
          0,
      );
      expect(activities.claimPinnedCapacityAttempt).not.toHaveBeenCalled();
    });
  }, 60_000);
  it("retains permits and lease until durable cleanup succeeds", async () => {
    const activities = fixtures(1);
    const cleaning = deferred();
    const resume = deferred();
    activities.cleanupSandboxStage.mockImplementationOnce(async () => {
      cleaning.resolve();
      await resume.promise;
      throw new Error("FailedKillPod");
    });
    await withWorkers(activities, async (coordinator, start) => {
      const handle = await start("cleanup-retry");
      await cleaning.promise;
      const state = await coordinator.query<Coordinator>("admissionState");
      expect(state.admission.permits.filter((p) => !p.cleanupConfirmed)).toHaveLength(1);
      expect(executions.get("cleanup-retry")?.leaseToken).toBeTruthy();
      expect(activities.executePinnedSandboxWave).not.toHaveBeenCalled();
      resume.resolve();
      await handle.result();
      expect(activities.cleanupSandboxStage).toHaveBeenCalledTimes(4);
      expect(executions.get("cleanup-retry")?.leaseToken).toBeNull();
    });
  }, 60_000);
  it("does not release timed-out producers on cancellation or mismatched acknowledgments", async () => {
    const activities = fixtures(1);
    const started = deferred();
    const stopped = deferred();
    const prepare = activities.prepareSandboxAttempt.getMockImplementation()!;
    activities.prepareSandboxAttempt.mockImplementation(async (...args) => {
      started.resolve();
      await stopped.promise;
      return prepare(...args);
    });
    await withWorkers(activities, async (coordinator, start) => {
      const handle = await start("producer-timeout");
      try {
        await started.promise;
        await env.sleep(61_000);
        type Recovery = { runId: string; permitId: string; timeoutType: string };
        let recovery: Recovery | null = null;
        await until(async () =>
          Boolean((recovery = await handle.query<Recovery | null>("judgeExecutorRecovery"))),
        );
        expect(recovery).toMatchObject({ timeoutType: "HEARTBEAT" });
        await handle.signal("confirmJudgeExecutorStopped", {
          runId: "wrong",
          permitId: recovery!.permitId,
        });
        await handle.cancel();
        expect(await handle.query("judgeExecutorRecovery")).toEqual(recovery);
        expect(activities.cleanupSandboxStage).not.toHaveBeenCalled();
        expect(
          (await coordinator.query<Coordinator>("admissionState")).admission.permits.filter(
            (p) => !p.cleanupConfirmed,
          ),
        ).toHaveLength(1);
        stopped.resolve();
        await handle.signal("confirmJudgeExecutorStopped", recovery);
        await expect(handle.result()).rejects.toThrow();
        expect(activities.cleanupSandboxAttempt).toHaveBeenCalledOnce();
        expect(activities.prepareSandboxAttempt).toHaveBeenCalledOnce();
      } finally {
        stopped.resolve();
      }
    });
  }, 120_000);
  it("relinquishes quota after drain and retains that state across control restart", async () => {
    const activities = fixtures();
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
    await withWorkers(activities, async (coordinator, _start, restart) => {
      await expect(
        coordinator.executeUpdate("relinquishJudgeQuota", { args: [] }),
      ).rejects.toThrow();
      await coordinator.executeUpdate("configureJudgeDispatch", {
        args: [{ route: "legacy", draining: true }],
      });
      block = true;
      await coordinator.signal("activateJudgeQuota");
      await entered.promise;
      let done = false;
      const release = coordinator
        .executeUpdate("relinquishJudgeQuota", { args: [] })
        .then(() => {
          done = true;
        });
      await until(async () =>
        Boolean((await coordinator.query<{ paused: boolean }>("admissionState")).paused),
      );
      expect(done).toBe(false);
      resume.resolve();
      await release;
      await restart();
      expect(await coordinator.query("admissionState")).toMatchObject({
        paused: true,
        quotaManaged: false,
        quotaReady: false,
      });
      await env.sleep("31s");
      await until(async () => activities.refreshJudgeCapacity.mock.calls.at(-1)?.[2] === false);
    });
  }, 60_000);
  it("recovers a terminated finalizing owner after lease release without orphaning FIFO", async () => {
    const activities = fixtures(1);
    const released = deferred();
    const resume = deferred();
    const release = activities.releasePinnedCapacityAttempt.getMockImplementation()!;
    let first = true;
    activities.releasePinnedCapacityAttempt.mockImplementation(async (...args) => {
      await release(...args);
      if (first) {
        first = false;
        released.resolve();
        await resume.promise;
      }
    });
    await withWorkers(activities, async (coordinator, start) => {
      const old = await start("released-owner", { studentId: "same" });
      await released.promise;
      expect(executions.get("released-owner")?.leaseToken).toBeNull();
      const state = await coordinator.query<Coordinator>("admissionState");
      const run = state.admission.runs.find(
        (run) => state.runOwners[run.runId] === old.workflowId,
      )!;
      expect(state.fullCleanupConfirmed).toContain(run.runId);
      await old.terminate("Worker workflow lost after cleanup");
      resume.resolve();
      const recovered = await start(
        "released-owner",
        { ...executions.get("released-owner")! },
        1,
      );
      await recovered.result();
      expect(activities.prepareSandboxAttempt).toHaveBeenCalledOnce();
      await (await start("next-owner", { studentId: "same" })).result();
      const after = await coordinator.query<Coordinator>("admissionState");
      expect(after.admission.runs.filter((run) => !run.finished)).toEqual([]);
    });
  }, 60_000);
  it("recovers an orphan permit even when termination preceded the DB lease claim", async () => {
    const activities = fixtures(1);
    const claiming = deferred();
    const resume = deferred();
    const claim = activities.claimPinnedCapacityAttempt.getMockImplementation()!;
    let first = true;
    activities.claimPinnedCapacityAttempt.mockImplementation(async (...args) => {
      if (first) {
        first = false;
        claiming.resolve();
        await resume.promise;
      }
      return claim(...args);
    });
    await withWorkers(activities, async (coordinator, start) => {
      const old = await start("unclaimed-permit");
      await claiming.promise;
      expect(executions.get("unclaimed-permit")?.leaseToken).toBeNull();
      await old.terminate("Lost before claim");
      const recovered = await start(
        "unclaimed-permit",
        { ...executions.get("unclaimed-permit")! },
        1,
      );
      type Recovery = { runId: string; permitId: string };
      let recovery: Recovery | null = null;
      await until(async () =>
        Boolean(
          (recovery = await recovered
            .query<Recovery | null>("judgeExecutorRecovery")
            .catch(() => null)),
        ),
      );
      expect(activities.cleanupSandboxAttempt).not.toHaveBeenCalled();
      expect(
        (await coordinator.query<Coordinator>("admissionState")).admission.permits.filter(
          (p) => !p.cleanupConfirmed,
        ),
      ).toHaveLength(1);
      resume.resolve();
      await recovered.signal("confirmJudgeExecutorStopped", recovery);
      await recovered.result();
      expect(activities.prepareSandboxAttempt).toHaveBeenCalledOnce();
      expect(
        (await coordinator.query<Coordinator>("admissionState")).admission.runs.filter(
          (run) => !run.finished,
        ),
      ).toEqual([]);
    });
  }, 60_000);
  it("waits for persisted acceptance order before initialization without taking a permit", async () => {
    const activities = fixtures(1);
    activities.judgeExecutionTurn.mockResolvedValue("wait");
    await withWorkers(activities, async (coordinator, start) => {
      const handle = await start("persisted-fifo");
      await until(async () => activities.judgeExecutionTurn.mock.calls.length > 0);
      expect(activities.initializePinnedSandboxAttempt).not.toHaveBeenCalled();
      expect(
        (await coordinator.query<Coordinator>("admissionState")).admission.permits,
      ).toEqual([]);
      activities.judgeExecutionTurn.mockResolvedValue("ready");
      await env.sleep("31s");
      await handle.result();
      expect(activities.prepareSandboxAttempt).toHaveBeenCalledOnce();
    });
  }, 60_000);
  it("keeps FIFO waiters asleep across central reconciliations and a coordinator restart", async () => {
    const activities = fixtures(1);
    activities.judgeExecutionTurn.mockResolvedValue("wait");
    await withWorkers(activities, async (coordinator, start, restart) => {
      const first = await start("fifo-sleep-first");
      const second = await start("fifo-sleep-second");
      await until(
        async () =>
          Object.keys(
            (await coordinator.query<Coordinator>("admissionState")).fifoWaiters ?? {},
          ).length === 2,
      );
      await restart();
      await env.sleep("95s");
      expect(activities.judgeExecutionTurn).toHaveBeenCalledTimes(2);
      expect(
        activities.resolveJudgeFifoWaiters.mock.calls.filter(([rows]) => rows.length === 2)
          .length,
      ).toBeGreaterThanOrEqual(2);
      for (const handle of [first, second]) {
        expect(
          (await handle.fetchHistory()).events
            ?.filter((event) => event.timerStartedEventAttributes)
            .map((event) =>
              Number(event.timerStartedEventAttributes?.startToFireTimeout?.seconds),
            ),
        ).toEqual([1800]);
      }
      expect(activities.initializePinnedSandboxAttempt).not.toHaveBeenCalled();
      activities.judgeExecutionTurn.mockResolvedValue("ready");
      await Promise.all([first.result(), second.result()]);
      await until(
        async () =>
          Object.keys(
            (await coordinator.query<Coordinator>("admissionState")).fifoWaiters ?? {},
          ).length === 0,
      );
    });
  }, 60_000);
  it("rechecks its turn after the fallback interval when no wake ever arrives", async () => {
    const activities = fixtures(1);
    activities.judgeExecutionTurn.mockResolvedValue("wait");
    activities.resolveJudgeFifoWaiters.mockResolvedValue([]);
    await withWorkers(activities, async (coordinator, start) => {
      const handle = await start("fifo-fallback");
      await until(async () => activities.judgeExecutionTurn.mock.calls.length >= 1);
      const registered = async () =>
        Object.values(
          (await coordinator.query<Coordinator>("admissionState")).fifoWaiters ?? {},
        ).map((row) => row.check);
      await until(async () => (await registered()).length === 1);
      await env.sleep("29m");
      expect(activities.judgeExecutionTurn).toHaveBeenCalledTimes(1);
      await env.sleep("2m");
      await until(async () => activities.judgeExecutionTurn.mock.calls.length === 2);
      await until(async () => JSON.stringify(await registered()) === "[1]");
      expect(activities.initializePinnedSandboxAttempt).not.toHaveBeenCalled();
      activities.judgeExecutionTurn.mockResolvedValue("ready");
      activities.resolveJudgeFifoWaiters.mockImplementation(async (waiters) =>
        waiters.map((row) => ({ ...row, outcome: "ready" })),
      );
      await env.sleep("31s");
      await handle.result();
      expect(activities.prepareSandboxAttempt).toHaveBeenCalledOnce();
      await until(async () => (await registered()).length === 0);
    });
  }, 60_000);
  it("rechecks DB authority after an early wake and ignores duplicate or stale registrations", async () => {
    const activities = fixtures(1);
    activities.judgeExecutionTurn.mockResolvedValue("wait");
    activities.resolveJudgeFifoWaiters.mockResolvedValue([]);
    activities.resolveJudgeFifoWaiters.mockImplementationOnce(async (waiters) =>
      waiters.map((waiter) => ({ ...waiter, outcome: "ready" })),
    );
    await withWorkers(activities, async (coordinator, start) => {
      const handle = await start("fifo-spurious");
      await until(async () => activities.judgeExecutionTurn.mock.calls.length >= 2);
      await until(async () =>
        Object.values(
          (await coordinator.query<Coordinator>("admissionState")).fifoWaiters ?? {},
        ).some((row) => !row.notified),
      );
      const waiter = Object.values(
        (await coordinator.query<Coordinator>("admissionState")).fifoWaiters!,
      )[0]!;
      const checks = activities.judgeExecutionTurn.mock.calls.length;
      await coordinator.signal("waitForJudgeFifo", waiter);
      await coordinator.signal("waitForJudgeFifo", { ...waiter, check: waiter.check - 1 });
      await handle.signal("judgeFifoWake", {
        requestId: waiter.requestId,
        check: waiter.check - 1,
      });
      await handle.signal("judgeFifoWake", {
        requestId: "old-attempt/fifo",
        check: waiter.check + 1,
      });
      await env.sleep("65s");
      expect(activities.judgeExecutionTurn).toHaveBeenCalledTimes(checks);
      expect(activities.initializePinnedSandboxAttempt).not.toHaveBeenCalled();
      activities.judgeExecutionTurn.mockResolvedValue("ready");
      activities.resolveJudgeFifoWaiters.mockImplementation(async (waiters) =>
        waiters.map((row) => ({ ...row, outcome: "ready" })),
      );
      await env.sleep("31s");
      await handle.result();
      expect(activities.prepareSandboxAttempt).toHaveBeenCalledOnce();
    });
  }, 60_000);
  it("retains FIFO registrations through a failed batch read", async () => {
    const activities = fixtures(1);
    activities.judgeExecutionTurn.mockResolvedValue("wait");
    activities.resolveJudgeFifoWaiters.mockRejectedValue(new Error("Database unavailable"));
    await withWorkers(activities, async (coordinator, start, restart) => {
      const handle = await start("fifo-read-failure");
      await until(async () => activities.resolveJudgeFifoWaiters.mock.calls.length > 0);
      await restart();
      await env.sleep("65s");
      expect(
        Object.values(
          (await coordinator.query<Coordinator>("admissionState")).fifoWaiters ?? {},
        ),
      ).toHaveLength(1);
      expect(activities.initializePinnedSandboxAttempt).not.toHaveBeenCalled();
      activities.judgeExecutionTurn.mockResolvedValue("ready");
      activities.resolveJudgeFifoWaiters.mockImplementation(async (waiters) =>
        waiters.map((row) => ({ ...row, outcome: "ready" })),
      );
      await env.sleep("31s");
      await handle.result();
    });
  }, 60_000);
  it("retires a DB-cancelled FIFO waiter without sandbox initialization", async () => {
    const activities = fixtures(1);
    activities.judgeExecutionTurn.mockResolvedValue("wait");
    await withWorkers(activities, async (coordinator, start) => {
      const handle = await start("fifo-db-cancelled");
      await until(
        async () =>
          Object.keys(
            (await coordinator.query<Coordinator>("admissionState")).fifoWaiters ?? {},
          ).length === 1,
      );
      activities.judgeExecutionTurn.mockResolvedValue("obsolete");
      await env.sleep("31s");
      await handle.result();
      expect(activities.initializePinnedSandboxAttempt).not.toHaveBeenCalled();
      expect(activities.claimPinnedCapacityAttempt).not.toHaveBeenCalled();
      await until(
        async () =>
          Object.keys(
            (await coordinator.query<Coordinator>("admissionState")).fifoWaiters ?? {},
          ).length === 0,
      );
    });
  }, 60_000);
  it("unregisters a cancelled FIFO waiter promptly without waiting for reconciliation", async () => {
    const activities = fixtures(1);
    activities.judgeExecutionTurn.mockResolvedValue("wait");
    await withWorkers(activities, async (coordinator, start) => {
      const handle = await start("fifo-temporal-cancelled");
      await until(
        async () =>
          Object.keys(
            (await coordinator.query<Coordinator>("admissionState")).fifoWaiters ?? {},
          ).length === 1,
      );
      await handle.cancel();
      await expect(handle.result()).rejects.toThrow();
      await until(
        async () =>
          Object.keys(
            (await coordinator.query<Coordinator>("admissionState")).fifoWaiters ?? {},
          ).length === 0,
      );
      expect(activities.claimPinnedCapacityAttempt).not.toHaveBeenCalled();
    });
  }, 60_000);
  it("waits without a timer before claim but retains heartbeats after claim", async () => {
    const activities = fixtures(1);
    const prepare = activities.prepareSandboxAttempt.getMockImplementation()!;
    await withWorkers(activities, async (coordinator, start) => {
      await coordinator.signal("pauseJudgeAdmission", true);
      activities.prepareSandboxAttempt.mockImplementation(async (...args) => {
        await coordinator.signal("pauseJudgeAdmission", true);
        return prepare(...args);
      });
      const handle = await start("permit-signal-wait");
      await until(
        async () =>
          (await coordinator.query<Coordinator>("admissionState")).admission.pending.length ===
          1,
      );
      await env.sleep("95s");
      expect(activities.heartbeatPinnedCapacityAttempt).not.toHaveBeenCalled();
      expect(
        (await handle.fetchHistory()).events?.filter(
          (event) => event.timerStartedEventAttributes,
        ),
      ).toEqual([]);
      await coordinator.signal("pauseJudgeAdmission", false);
      await until(
        async () =>
          activities.prepareSandboxAttempt.mock.calls.length === 1 &&
          (await coordinator.query<Coordinator>("admissionState")).admission.pending.some(
            (row) => row.phase === "wave",
          ),
      );
      await env.sleep("65s");
      expect(
        activities.heartbeatPinnedCapacityAttempt.mock.calls.length,
      ).toBeGreaterThanOrEqual(2);
      expect(executions.get("permit-signal-wait")?.leaseToken).not.toBeNull();
      await coordinator.signal("pauseJudgeAdmission", false);
      await handle.result();
    });
  }, 60_000);
  it("redirects later untouched FIFO waiters while their predecessors await baseline workers", async () => {
    const activities = fixtures(1);
    const turn = activities.judgeExecutionTurn.getMockImplementation()!;
    activities.judgeExecutionTurn.mockImplementation(async (id) => {
      const routed = await turn(id);
      return routed === "redirect" ? routed : id === "fifo-rollback-second" ? "wait" : "ready";
    });
    await withWorkers(activities, async (coordinator, start) => {
      await coordinator.signal("pauseJudgeAdmission", true);
      const first = await start("fifo-rollback-first", { studentId: "same" });
      const second = await start("fifo-rollback-second", { studentId: "same" });
      await until(async () =>
        activities.judgeExecutionTurn.mock.calls.some(([id]) => id === "fifo-rollback-second"),
      );
      expect(
        activities.initializePinnedSandboxAttempt.mock.calls.every(
          ([id]) => id !== "fifo-rollback-second",
        ),
      ).toBe(true);
      await coordinator.executeUpdate("configureJudgeDispatch", {
        args: [{ route: "legacy", draining: true }],
      });
      await coordinator.signal("pauseJudgeAdmission", false);
      await env.sleep("31s");
      await until(
        async () =>
          (await first.describe()).taskQueue === "judge" &&
          (await second.describe()).taskQueue === "judge",
      );
      expect(activities.prepareSandboxAttempt).not.toHaveBeenCalled();
      expect(activities.relinquishPinnedCapacityStrategy).toHaveBeenCalledTimes(2);
      expect(
        (await coordinator.query<Coordinator>("admissionState")).admission.runs.filter(
          (run) => !run.finished,
        ),
      ).toEqual([]);
    });
  }, 60_000);
  it("cleans a cancelled terminated owner with no DB lease using exact coordinator ownership", async () => {
    const activities = fixtures(1);
    const claiming = deferred();
    const resume = deferred();
    const claim = activities.claimPinnedCapacityAttempt.getMockImplementation()!;
    activities.claimPinnedCapacityAttempt.mockImplementation(async (...args) => {
      claiming.resolve();
      await resume.promise;
      return claim(...args);
    });
    await withWorkers(activities, async (coordinator, start) => {
      const old = await start("cancelled-orphan");
      await claiming.promise;
      const state = await coordinator.query<Coordinator>("admissionState");
      const run = state.admission.runs.find(
        (run) => state.runOwners[run.runId] === old.workflowId,
      )!;
      await old.terminate("Stopped before DB claim");
      const row = executions.get("cancelled-orphan")!;
      row.state = "cancelled";
      row.workflowId = "new-owner-fence";
      resume.resolve();
      const cleanup = await env.client.workflow.start("judgeCleanupWorkflow", {
        workflowId: "cleanup-cancelled-orphan",
        taskQueue: "judge-control",
        args: [
          {
            executionId: "cancelled-orphan",
            workflowId: old.workflowId,
            leaseToken: run.runId,
            capacity: true,
          },
        ],
      });
      try {
        type Recovery = { runId: string; permitId: string };
        let recovery: Recovery | null = null;
        await until(async () =>
          Boolean(
            (recovery = await cleanup
              .query<Recovery | null>("judgeExecutorRecovery")
              .catch(() => null)),
          ),
        );
        expect(activities.cleanupSandboxAttempt).not.toHaveBeenCalled();
        expect(row.leaseToken).toBeNull();
        await cleanup.signal("confirmJudgeExecutorStopped", recovery);
        await cleanup.result();
        expect(activities.cleanupSandboxAttempt).toHaveBeenCalledWith(run.runId);
        expect(
          (await coordinator.query<Coordinator>("admissionState")).admission.runs.filter(
            (entry) => entry.runId === run.runId && !entry.finished,
          ),
        ).toEqual([]);
      } finally {
        await cleanup.terminate("Test cleanup").catch(() => undefined);
      }
    });
  }, 60_000);
  it("tracks temporary input ownership before initialization can write artifacts", async () => {
    const activities = fixtures(1);
    const initialized = deferred();
    const resume = deferred();
    const initialize = activities.initializePinnedSandboxAttempt.getMockImplementation()!;
    let first = true;
    activities.initializePinnedSandboxAttempt.mockImplementation(async (...args) => {
      const result = await initialize(...args);
      if (first) {
        first = false;
        initialized.resolve();
        await resume.promise;
      }
      return result;
    });
    await withWorkers(activities, async (coordinator, start) => {
      const old = await start("initialization-orphan");
      await initialized.promise;
      const state = await coordinator.query<Coordinator>("admissionState");
      const run = state.admission.runs.find(
        (run) => state.runOwners[run.runId] === old.workflowId,
      )!;
      expect(run).toBeDefined();
      expect(executions.get("initialization-orphan")?.leaseToken).toBeNull();
      expect(state.admission.permits).toEqual([]);
      await old.terminate("Lost during input storage");
      resume.resolve();
      const recovered = await start(
        "initialization-orphan",
        { ...executions.get("initialization-orphan")! },
        1,
      );
      type Recovery = { runId: string; permitId: string };
      let recovery: Recovery | null = null;
      await until(async () =>
        Boolean(
          (recovery = await recovered
            .query<Recovery | null>("judgeExecutorRecovery")
            .catch(() => null)),
        ),
      );
      expect(recovery).toMatchObject({ runId: run.runId });
      await recovered.signal("confirmJudgeExecutorStopped", recovery);
      await recovered.result();
      expect(activities.cleanupSandboxAttempt).toHaveBeenCalledWith(run.runId);
      expect(activities.prepareSandboxAttempt).toHaveBeenCalledOnce();
    });
  }, 60_000);
});
