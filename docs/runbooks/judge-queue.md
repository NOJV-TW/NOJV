# Judge Queue

Operator steps for inspecting, sizing and unblocking judging. Ordering is Temporal
task-queue priority bounded by judge-worker Activity slots; there is no scheduler
workflow to inspect or signal. Mechanics and states are in
[Judge Pipeline](../architecture/JUDGE_PIPELINE.md#queue-priority-and-capacity);
rationale in JDG-12, JDG-13 and JDG-22.

## Inspect

```bash
temporal task-queue describe -t judge
temporal task-queue describe -t judge-state
temporal task-queue describe -t judge-cleanup
temporal workflow list --query 'WorkflowType="durableJudgeWorkflow" AND ExecutionStatus="Running"'
```

- `judge` carries only sandbox stage and reconcile activities; `judge-state` carries
  bookkeeping and `judge-cleanup` deferred stage cleanup. Neither should hold a
  backlog: a stuck cleanup holds the execution open, and the student's next
  submission waits for it.
- In the database, `JudgeExecution.state`, `reasonCode`, `nextAttemptAt` and
  `lastProgressAt` describe queued and recovering work. `waiting_capacity` means the
  sandbox quota rejected a Job; it retries every 30 s. `blocked` retries every 15 min.
- Alerts: `nojv-judge-queue-age`, `nojv-judge-recovery-blocked`,
  `nojv-judge-cleanup-pending`, `nojv-judge-wall-clock-timeouts`
  ([observability runbook](observability-setup.md)).

## Temporal server requirements

Set in `infra/docker/temporal-dynamic-config.yaml` (compose) and `server.dynamicConfig`
in the Temporal Helm values (`infra/gcp/gke/temporal/`), then let the config reload:

- `matching.useNewMatcher: true` — required for priority; set it explicitly.
- `matching.enableFairness: true` — without it dispatch inside one priority is FIFO;
  the per-student dispatch gate still limits a student to one dispatched execution
  per queue class.
- One read and one write partition for `judge`, `judge-state`, `judge-cleanup` and
  `platform`. With
  the default four, few pollers leave tasks in unpolled partitions for up to a long
  poll.

## Capacity

- Slots = `worker.judge.concurrency` × judge replicas. Each slot runs one stage Job
  whose run container requests half of `worker.sandbox.runParallelism` CPUs and is
  limited to the full count. Slots × runParallelism is the number of cases running
  at once; the chart fails to render when the half-CPU requests leave less than one
  CPU of `sandbox.resourceQuota.requestsCpu` for terminating stage Pods. A standard
  stage frees its slot when its result is read; its Pod keeps counting against the
  quota until it turns terminal.
- The executor lowers a stage's parallelism when the memory limit would push the run
  container past the sandbox memory ceiling. Node allocatable CPU minus platform pod
  requests also bounds how many Jobs schedule; the chart cannot check it. Read
  `kubectl describe node` (Allocated resources) before raising slots: single-machine
  platform pods request about 3.2 CPU, so 10 vCPU leaves room for thirteen half-CPU
  stage Pods. A stage Pod that does not fit reports `Unschedulable`, which caps the
  load-aware budget; one still unscheduled after 30 s fails with
  `SandboxBackpressureError … Insufficient cpu`.
- Before an exam, raise concurrency and quota together (Helm values); lower them
  afterwards.

Load-aware slots (`worker.judge.minConcurrency`; single-machine: min 2, ceiling
`worker.judge.concurrency` 8):

- The budget starts at the minimum and grows by one slot at most every 5 s, only
  while every budgeted slot runs a stage, node CPU (`/proc/stat`) is under 80%,
  node `MemAvailable` is at least 20% of `MemTotal` and the judge worker's own
  cgroup working set is under 75% of its memory limit. Over any limit it drops to
  one below the running count, never under the minimum; running stages finish.
  A stage Pod reporting `Unschedulable` or a Job event `exceeded quota` does the
  same and pauses growth for 30 s; a wall-clock TLE of a program that used at least
  half its CPU limit pauses it for 60 s. Each stage Job reports each signal once.
  Fixed slots (no `minConcurrency`) have no worker memory guard and ignore these
  signals.
  Mechanics are in [Judge Pipeline](../architecture/JUDGE_PIPELINE.md#queue-priority-and-capacity).
- The signal is host-wide `/proc`, valid only while the one judge replica shares the
  node with its sandboxes. Leave `minConcurrency` unset on multi-node clusters; the
  chart refuses it with more than one judge replica.
- Observe adaptation with the `judge slot budget changed` log line (`budget`,
  `used`, `cpu`, `memoryAvailable`, `workerMemory`; `null` when the worker has no
  memory limit), the `judge slot budget capped by capacity signal` line (`signal`)
  or the `judge_slot_budget`, `judge_slots_used`, `judge_node_cpu_utilization`,
  `judge_worker_memory_utilization` and `judge_capacity_signals_total` metrics.
- A budget pinned at the minimum with `workerMemory` at or above 0.75 means the
  worker itself is near its limit; judging continues at the minimum instead of
  OOMKilling. Raise the worker memory limit if it persists outside a burst.
- The ceiling is still bounded by the quota: a standard stage Pod requests half of
  `runParallelism` CPUs (its run init container) and an interactive Pod the sandbox
  `cpuLimit` plus `cpuRequest`, so the single-machine 6-CPU quota holds eight running
  and four terminating standard stages, or four interactive stages; the chart allows
  at most ten standard slots at that quota. A stage the quota rejects frees its slot
  and retries as `waiting_capacity`. Raising the ceiling needs a matching quota and
  an exam-scale stress test, and the quota must stay within node allocatable CPU
  left by the platform pods.
- Per-stage wall time is in the `Kubernetes sandbox phase timings` log line:
  `payloadConfigMapsMs`, `jobCreateMs`, `scheduleAndExecutionMs` (until every
  container exited), `logsMs`, `podTerminationMs` (kubelet stopping the Pod sandbox
  after the containers exited), `cleanupMs` and `totalMs`; a deferred standard stage
  logs `deferredCleanup: true` with null termination and cleanup times, and
  `cleanupJudgeStage` logs them in `Kubernetes sandbox deferred cleanup timings`. The
  `Kubernetes sandbox lifecycle timings` line splits the Pod's own startup and
  container run times, at one-second resolution. A slot is held for `totalMs`.
- `judge_wall_clock_timeouts_total` counts TLEs whose CPU time stayed under the limit;
  `nojv-judge-wall-clock-timeouts` fires on more than two in ten minutes. Lower the
  ceiling if it keeps firing; one from a program that used at least half its CPU
  limit already pauses budget growth for 60 s, while sleeping programs only count.

## Bulk rejudges

- Rejudges run in the `background` class at priority 5, behind every live
  submission.
- To park a bulk rejudge, set its executions' `nextAttemptAt` into the future and
  cancel their workflows. The submission sweeper's reconciliation (every minute, 100
  rows per run) re-dispatches them as new recovery epochs once `nextAttemptAt`
  passes.
- Park and release whole students at a time: the dispatch gate orders a student's
  executions by `createdAt` and ignores `nextAttemptAt`, so a released execution waits
  behind any earlier parked one of the same student.
- Re-dispatching an existing workflow ID is a no-op (`REJECT_DUPLICATE`); the
  reconciler moves a cancelled workflow's row to a new epoch.
- Never edit scores or verdicts to unblock a queue.

## Compacting judge snapshots

Format-1 snapshots embed every testcase; `compact-judge-snapshots` rewrites a
terminal, unleased execution's snapshot to format 2, pinning the problem's
current testcase objects when the content matches and otherwise writing
content-addressed `problems/{problemId}/pinned-testcases/{sha256}` objects. The
old snapshot is queued for cleanup. Runs are idempotent and process one
execution at a time (peak memory about 7× the largest snapshot), so use the
judge worker pod in a quiet window, and only with owner approval in production:

```bash
sudo -n k3s kubectl -n nojv exec deploy/nojv-worker -- node dist/compact-judge-snapshots.js --dry-run
sudo -n k3s kubectl -n nojv exec deploy/nojv-worker -- node dist/compact-judge-snapshots.js --limit 200
```

Options: `--limit` (default 1000) and `--min-bytes` (default 1 MiB; smaller
snapshots are left alone). Each execution prints one JSON line; the last line
has totals, and the exit code is 1 if any execution failed. Active executions
are skipped and picked up by a later run.

## Stuck leases and cleanup

- An expired lease is not proof that a sandbox stopped. `cleanupJudgeStage`,
  `reconcileJudgeStage` and `judgeCleanupWorkflow` (ID `judge-cleanup-<leaseToken>`)
  confirm the run's Jobs, Pods, ConfigMaps and PVCs are gone before the lease is
  released.
- Match run ID, Pod UID and CRI/cgroup identity before any directed host cleanup; do
  not restart k3s or containerd to clear remnants.
- Orphaned per-stage payload ConfigMaps (`nojv-run-id` label, `judge-<runId>-*`)
  need no manual deletion: every 15 min the judge worker deletes those older than
  10 min whose run has no Job or Pod, and logs `Orphan run payloads swept`. Count
  them with
  `kubectl -n nojv-sandbox get configmaps -l nojv-run-id --no-headers | wc -l`; a
  count that stays high across sweeps while runs have no Job points at a failing
  sweep (`Orphan run payload sweep failed` log line).
- Cancel a workflow rather than terminating it so its cleanup runs.
