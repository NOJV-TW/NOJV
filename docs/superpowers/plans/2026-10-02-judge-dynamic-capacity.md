# Judge Dynamic Capacity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Raise single-machine judge throughput and cut verdict latency by reserving half a CPU per stage, driving the slot budget from live scheduler and wall-clock feedback, and releasing the judge slot as soon as a stage's result is read.

**Architecture:** Spec: `docs/superpowers/specs/2026-10-02-judge-dynamic-capacity-design.md`. The standard K8s executor hands its post-result cleanup to the caller through `SandboxExecutionContext.deferCleanup`; `executeJudgeStage` returns it, and `durableJudgeWorkflow` (behind `patched("deferred-stage-cleanup-v1")`) runs a new `cleanupJudgeStage` activity on `judge-state` while it publishes the verdict. The load-aware slot supplier subscribes to a small in-process signal module fed by the job watcher (Unschedulable) and the wall-clock TLE metric.

**Tech Stack:** TypeScript (ESM), Temporal TS SDK, `@kubernetes/client-node`, Vitest (unit + temporal-integration), Helm chart tests.

Run everything from `/Users/takala/code/NOJV/.worktrees/judge-throughput`. No comments in code (repo rule). Commit after each task.

---

### Task 1: Core types for deferred cleanup

**Files:** Modify `packages/core/src/sandbox.ts:108-117`

```ts
export interface DeferredStageCleanup {
  jobName: string;
  namespace: string;
  payloadNames: string[];
  deadlineSeconds: number;
}

export interface SandboxExecutionContext {
  runId: string;
  signal: AbortSignal;
  deferCleanup?: (cleanup: DeferredStageCleanup) => void;
}

export interface SandboxExecutor {
  cleanupRun?(runId: string): Promise<void>;
  reconcile?(runId: string, owner?: string): Promise<boolean>;
  cleanupStage?(cleanup: DeferredStageCleanup, signal: AbortSignal): Promise<void>;
  execute(request: SandboxRequest, execution: SandboxExecutionContext): Promise<SandboxResult>;
}
```

Verify: `pnpm --filter @nojv/core typecheck && pnpm build --filter=@nojv/core`.

### Task 2: Stage run container reserves half its CPU limit

**Files:** Modify `apps/worker/src/sandbox/kubernetes/job-manifests.ts` (runResources, ~line 82); Test `tests/unit/worker/k8s-checker.test.ts:197-203`

1. Change the test "reserves exactly runParallelism CPUs for the run container" to expect `requests.cpu: "1"` (half of 2) and `limits.cpu: "2"`; rename to "requests half of runParallelism CPUs and limits the full count". Run `npx vitest run --project unit tests/unit/worker/k8s-checker.test.ts` → FAIL.
2. Implement: `export const STAGE_CPU_REQUEST_FRACTION = 0.5;` and `requests.cpu: String(params.runParallelism * STAGE_CPU_REQUEST_FRACTION)`, limits unchanged. Run → PASS.
3. Run the quota tests that compute Pod requests (`tests/unit/worker/k8s-*` grep `findSandboxQuotaViolation`) → PASS.

### Task 3: Standard executor defers cleanup when asked; K8sExecutor cleans a deferred stage

**Files:** Modify `apps/worker/src/sandbox/kubernetes/standard-executor.ts`, `apps/worker/src/sandbox/kubernetes/executor.ts`; Test `tests/unit/worker/k8s-payload-orchestration.test.ts`

1. Tests (use the file's `clients()` fake and `EXEC_CONFIG`):
   - "hands cleanup to the caller after the logs when deferCleanup is set": execute with `deferCleanup: vi.fn()`; expect the result returned, `deferCleanup` called once with `{ jobName: "judge-<runId>", namespace, payloadNames: [...per-stage names], deadlineSeconds: expect.any(Number) }`, and `deleteNamespacedJob` not called.
   - "cleans up inline when execution fails even with deferCleanup": make the job fail (reuse the FailedCreate admission fixture) → `deferCleanup` not called, cleanup ran.
   - "cleanupStage waits for the terminal Pod then deletes the Job and payloads": call `executor.cleanupStage(captured, signal)` → `deleteNamespacedJob` and ConfigMap deletes called with the captured names.
     Run → FAIL.
2. Implement in `KubernetesStandardExecutor.execute`: keep a `deferred` flag. After the result is built on the success path (including the compile-error return), if `execution.deferCleanup` is set: call it with `{ jobName, namespace: ns, payloadNames, deadlineSeconds }`, set `deferred = true`, and in `finally` skip `podTermination`/cleanup when `deferred` (still log the phase timings with `podTerminationMs: null, cleanupMs: null`). Failure paths are unchanged.
3. Add `KubernetesStandardExecutor.cleanupStage(cleanup, signal)`: `await this.jobWatcher.waitForPodTermination(jobName, namespace, deadlineSeconds, signal)` then `measurePhase`-free `this.cleanupResources.cleanup(jobName, namespace, payloadNames)`; log `podTerminationMs`/`cleanupMs` with `deferred: true`. Expose `K8sExecutor.cleanupStage` delegating to it.
4. Run the whole file → PASS.

### Task 4: ExecutorOwner passes deferCleanup through and exposes cleanupStage

**Files:** Modify `apps/worker/src/sandbox/shared/executor-owner.ts`; Test `tests/unit/worker/executor-owner*.test.ts` (grep; create `tests/unit/worker/executor-owner-deferred.test.ts` if none)

- `execute(request, signal, runId = this.createRunId(), deferCleanup?)` puts `deferCleanup` into the context only when defined (exactOptionalPropertyTypes).
- `cleanupStage(cleanup, signal)`: `this.executor.cleanupStage ? this.executor.cleanupStage(cleanup, signal) : Promise.resolve()`.
- Tests: a fake executor records the context; `cleanupStage` delegates; missing method resolves.

### Task 5: Capacity signals and supplier feedback

**Files:** Create `apps/worker/src/judge-capacity-signals.ts`; Modify `apps/worker/src/judge-slot-supplier.ts`, `apps/worker/src/sandbox/kubernetes/job-watch.ts` (`evaluateJobSnapshot`, after `podState` is computed), `apps/worker/src/sandbox/shared/judge-phase-metrics.ts` (`recordWallClockTimeouts`); Test `tests/unit/worker/judge-slot-supplier.test.ts`

```ts
type CapacitySignal = "unschedulable" | "wallClockTimeout";
const listeners = new Set<(signal: CapacitySignal) => void>();
export function onCapacitySignal(listener: (signal: CapacitySignal) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function emitCapacitySignal(signal: CapacitySignal): void {
  for (const listener of listeners) listener(signal);
}
```

Supplier: `UNSCHEDULABLE_PAUSE_SAMPLES = 12` (30 s), `WALL_CLOCK_PAUSE_SAMPLES = 24` (60 s). `signal(kind)`: `budget = max(min, min(budget, used - 1))`, `pausedSamples = max(pausedSamples, pause)`, log. In `adjust`, decrement `pausedSamples` per sample and allow growth only when it is 0. `startNodeLoadSlots` subscribes via `onCapacitySignal` and unsubscribes in `stop`.
Emit `unschedulable` in `evaluateJobSnapshot` when `!nextEverStarted && podState.unschedulableReason`; emit `wallClockTimeout` in `recordWallClockTimeouts` when `count > 0`.

Tests (write first, FAIL, then implement):

- "an Unschedulable stage drops the budget below the running count and pauses growth for 30 s"
- "a wall-clock TLE shrinks the budget and pauses growth for 60 s"
- "signals never take the budget under the minimum or revoke running slots"
- "startNodeLoadSlots reacts to emitted signals and unsubscribes on stop"
- job-watch: an Unschedulable pending Pod emits `unschedulable` (in `tests/unit/worker/k8s-job-watch.test.ts`, spy via `onCapacitySignal`).

### Task 6: Activities

**Files:** Modify `apps/worker/src/activities/judge-execution.ts`, `apps/worker/src/activities/judge-bundle.ts`; Test create `tests/unit/worker/judge-stage-activity.test.ts` (mock `@temporalio/activity`, `@nojv/application`, `@nojv/db`, `../activities/judge` owner)

- `executeJudgeStage(executionId, workflowId, index, deferCleanup = false)`: pass a capture callback to `getExecutorOwner().execute(request, signal, leaseToken, deferCleanup ? (c) => (deferred = c) : undefined)`. If `deferred`:
  - an SE result → `await getExecutorOwner().cleanupStage(deferred, signal)` before throwing (lease released as today);
  - otherwise `cleanupConfirmed = false` (lease kept) and return `{ status, cleanup: { ...deferred, leaseToken } }` after `saveJudgeStage`.
- `cleanupJudgeStage(executionId, workflowId, cleanup)`: heartbeat + `heartbeatJudgeStage` every 15 s (abort when not owned), `await getExecutorOwner().cleanupStage(cleanup, signal)`, `await releaseJudgeStage(executionId, workflowId, cleanup.leaseToken)`.
- Export `cleanupJudgeStage` from the bundle.
- Tests: deferral returns cleanup and does not release; no deferral releases as today; SE with deferral cleans inline then throws; cleanupJudgeStage cleans then releases; ownership loss aborts.

### Task 7: Workflow

**Files:** Modify `apps/worker/src/workflows/durable-judge.ts`; Test `tests/integration/temporal/durable-judge.test.ts`

- New proxy `cleanup = proxyActivities<typeof executionActivities>({ taskQueue: JUDGE_STATE_QUEUE, startToCloseTimeout: "5m", heartbeatTimeout: "60s", retry: { maximumAttempts: 5 } })`.
- `const deferred = patched("deferred-stage-cleanup-v1")` per stage call; `executeJudgeStage(..., deferred)`; if the result has `cleanup`, start `cleanup.cleanupJudgeStage(executionId, workflowId, stage.cleanup)` and keep the promise; `saved` → await it before `continue`; `finished` → run completePinnedJudge/publish (guarded by a `published` flag) then await cleanup before `finishJudgeExecution`.
- Tests (read memory note on the time-skipping harness: separate env per scenario, avoid `Promise.all(result())`): verdict published before cleanup resolves; cleanup failure takes the reconcile path without a second `publishVerdict`; existing replay fixtures still pass.

### Task 8: Chart

**Files:** Modify `infra/charts/nojv/templates/worker-judge.deployment.yaml:10-12`, `infra/charts/nojv/values-single-machine.yaml` (`worker.judge.concurrency: "12"`); Test the guard test (grep the guard message in `tests/`)

Guard: `$halfCores := div (mul replicas concurrency runParallelism) 2` compared with the quota; message names the half-CPU stage request. Run `pnpm lint:helm` and the chart unit tests.

### Task 9: Docs and decisions

JDG-06, JDG-13, JDG-25, OPS-11 per the spec; `docs/architecture/JUDGE_PIPELINE.md` (stage flow + capacity), `docs/runbooks/judge-queue.md` (capacity), `docs/operations/DEPLOYMENT.md` (capacity table: slots 2–12, stage request 500m). Run `pnpm lint:doc-drift`, `tests/unit/docs`.

### Task 10: Verify

`pnpm ci:verify`; `npx vitest run --project temporal-integration tests/integration/temporal/durable-judge.test.ts`; k3d suite `REQUIRE_K8S=1 pnpm test:integration:k8s` (context `k3d-nojv-judge`). Request code review (superpowers:requesting-code-review). Open PR; delete spec and plan in it.

### Task 11: Exam stress test and release (operator steps, outside the repo)

Scripts live in `~/.claude/projects/-Users-takala-code-NOJV/memory/stress-scripts/`. Create a temporary course, exam (no password/IP binding), one C problem, 140 temporary students with API tokens; arrival: 33 students in the first minute, then ~80 submissions/min for 5 min; concurrent API polling per student. Measure verdict latency p50/p95/max, web API p95, errors, restarts, wall-clock TLE, Unschedulable signals. Run baseline on v1.3.51 immediately before tagging, release, rerun, then delete everything. Record results in the Quality Ledger in a follow-up docs PR.
