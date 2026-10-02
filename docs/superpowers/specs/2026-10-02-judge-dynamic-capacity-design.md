# Judge dynamic capacity and early slot release

Status: in flight (owner approved A+B on 2026-10-02). Deleted by the PR that ships it.

## Problem

Measured on production (single machine, 10 vCPU `host` CPU, v1.3.51):

- An isolated one-stage C submission takes about 7.5 s from `createdAt` to a completed
  execution; the student's program runs for well under 1 s. Temporal and database
  orchestration is about 0.5 s. The stage activity (7.0–7.5 s) is Pod start (~1 s),
  run → judge container handoff (~1 s, PLEG relist), program and compare, then a wait for
  the Pod to turn `Succeeded` (1.4–1.6 s) and cleanup (0.3–0.4 s).
- A stage holds its judge slot for that whole time, including the ~1.9 s after its result
  is already known.
- Each stage Pod requests one CPU (`runParallelism`), so the node's request budget, not
  CPU use, caps concurrency: 6 slots on 10 vCPU while node CPU peaks at 55–75%.

The ceiling is a static Helm value; the owner wants capacity to follow the running
environment, as JDG-13 already does for the slot budget.

## Goals

- More stages per minute on the same hardware for typical (light) submissions.
- The verdict reaches the student as soon as the result is read.
- Capacity follows measured node state; no new operator knob.
- Isolation (JDG-05, JDG-06), timing fairness (CPU-time TLE) and durable cleanup (JDG-22)
  are unchanged.
- Proven by an exam-shaped production stress test before and after (2x Quiz 01).

## Design

### A. Smaller stage CPU reservation, load-driven slot budget

1. The run container of a standard stage requests half of its CPU limit
   (`STAGE_CPU_REQUEST_FRACTION = 0.5`, so 500m for `runParallelism` 1); the limit stays
   `runParallelism` CPUs. The judge container keeps `K8S_CPU_REQUEST` (300m). The Pod's
   effective request becomes 500m and its QoS class Burstable. CPU-time TLE is
   unaffected; the 2x wall-clock watchdog and `judge_wall_clock_timeouts_total` guard
   contention.
2. The load-aware supplier (JDG-13) keeps its CPU, node-memory and worker-memory limits
   and gains two feedback signals, both from state the worker already observes:
   - Scheduler feedback: when a stage Pod reports `PodScheduled=False` with reason
     `Unschedulable`, the budget drops to the number of stages whose Pods are scheduled
     and growth pauses for 30 s. The Pod itself keeps waiting (it schedules as soon as a
     finished Pod is deleted); the existing 30 s schedule grace still turns a longer wait
     into `SandboxBackpressureError`.
   - Wall-clock feedback: any wall-clock TLE (`timeMs < limit`) drops the budget to one
     below the running count (never under the minimum) and pauses growth for 60 s.
3. `WORKER_CONCURRENCY` stays the hard ceiling. Single-machine raises it to 12
   (quota 6 CPU / 0.5); the chart guard becomes
   `replicas x concurrency x runParallelism x 0.5 <= sandbox.resourceQuota.requestsCpu`.
   The quota stays the hard resource ceiling (OPS-11) and now also covers Pods that are
   still terminating.

No new env var: the reservation is a constant chosen from measurement (JDG-13 keeps
targets as constants), and the effective concurrency comes from live signals.

### B. Release the slot when the result is read

1. For standard Kubernetes stages, `executeJudgeStage` returns once the logs are read and
   the stage is saved: `{ status, cleanup: { jobName, namespace, payloadNames,
deadlineSeconds, leaseToken } }`. It does not release the lease.
2. A new activity `cleanupJudgeStage` on the `judge-state` queue (not a judge slot)
   heartbeats the lease, waits for the Pod's terminal phase (at most 10 s, as JDG-25),
   runs the existing UID-fenced cleanup and then `releaseJudgeStage`. It is idempotent
   (404/409 skipped) and retried by Temporal.
3. `durableJudgeWorkflow`, behind `patched("deferred-stage-cleanup-v1")`, starts the
   cleanup activity as soon as the stage returns. For a finished stage it runs
   `completePinnedJudge` and `publishVerdict` concurrently with cleanup, then awaits
   cleanup before `finishJudgeExecution`; for a saved stage it awaits cleanup before the
   next stage. A workflow flag prevents a second verdict publication if cleanup fails and
   the loop takes the existing reconcile path.
4. Interactive, Advanced and Docker executors keep inline cleanup.

### Failure handling

- Worker dies after the stage returns: the lease keeps its 120 s expiry; Temporal retries
  `cleanupJudgeStage` on the restarted worker; the workflow cannot finish first.
- Cleanup fails permanently: the lease stays, the workflow takes today's
  `reconcileJudgeStage` path, the verdict is not re-published.
- More Pods than the node can schedule: Pending Pods trigger scheduler feedback; the quota
  bounds the worst case at 12 stage Pods.

## Decision changes (same PR)

- JDG-06: a stage requests half its CPU limit; the limit is still `runParallelism`.
- JDG-13: scheduler and wall-clock feedback; ceiling rule becomes quota / stage request.
- JDG-25: the "returning the stage result and releasing the slot before cleanup" rejection
  is replaced by B (lease kept, cleanup as its own activity, quota sized for terminating
  Pods); the EventedPLEG line is updated (alpha again since v1.30, narrowed upstream in
  v1.37).
- OPS-11 and JDG-22: unchanged rules; text notes terminating Pods count against the quota.

## Verification

- Unit: stage manifest requests; supplier feedback signals; `executeJudgeStage` deferral;
  `cleanupJudgeStage`; workflow paths including duplicate-verdict protection.
- Temporal integration: durable-judge suite plus replay of existing histories.
- k3d Kubernetes suite.
- Production exam stress test, run on v1.3.51 (baseline) and on the release: a temporary
  course and exam with 140 temporary students, C submissions in the exam context
  (priority 1, per-student gate, exam scoring), opening burst then ~80 submissions/min,
  concurrent authenticated API polling with per-user API tokens. Everything is deleted
  afterwards and nothing runs during a real exam.
- Acceptance: 0 SE, 0 wall-clock TLE, 0 restarts or OOM, no sustained Unschedulable,
  verdict p95 no worse than baseline, web API p95 under 1 s.
