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
temporal workflow list --query 'WorkflowType="durableJudgeWorkflow" AND ExecutionStatus="Running"'
```

- `judge` carries only sandbox stage and reconcile activities; `judge-state` carries
  bookkeeping and should never hold a backlog.
- In the database, `JudgeExecution.state`, `reasonCode`, `nextAttemptAt` and
  `lastProgressAt` describe queued and recovering work. `waiting_capacity` means the
  sandbox quota rejected a Job; it retries every 30 s. `blocked` retries every 15 min.
- Alerts: `nojv-judge-queue-age`, `nojv-judge-recovery-blocked`,
  `nojv-judge-cleanup-pending`, `nojv-judge-wall-clock-timeouts`
  ([observability runbook](observability-setup.md)).

## Temporal server requirements

Set in `infra/docker/temporal-dynamic-config.yaml` (compose) or `server.dynamicConfig`
on the official Helm chart, then let the config reload:

- `matching.useNewMatcher: true` — required for priority; set it explicitly.
- `matching.enableFairness: true` — without it dispatch inside one priority is FIFO;
  the per-student dispatch gate still limits a student to one dispatched execution
  per queue class.
- One read and one write partition for `judge`, `judge-state` and `platform`. With
  the default four, few pollers leave tasks in unpolled partitions for up to a long
  poll.

## Capacity

- Slots = `worker.judge.concurrency` × judge replicas. Each slot runs one stage Job
  whose run container requests and is limited to `worker.sandbox.runParallelism`
  CPUs. Slots × runParallelism is the number of cases running at once; the chart
  fails to render when it exceeds `sandbox.resourceQuota.requestsCpu`.
- The executor lowers a stage's parallelism when the memory limit would push the run
  container past the sandbox memory ceiling. Node allocatable CPU minus platform pod
  requests also bounds how many Jobs schedule.
- Before an exam, raise concurrency and quota together (Helm values); lower them
  afterwards.

Load-aware slots (`worker.judge.minConcurrency`; single-machine: min 2, ceiling
`worker.judge.concurrency` 5):

- Above the minimum, Temporal's resource-based tuner adds a slot while node CPU is
  under 75% and the worker's own memory under 80%.
- Keep the SDK's default 50 ms ramp: every poll reserves a slot first, so a long ramp
  throttles polling itself.
- The judge container has no CPU limit so the tuner measures the node, not its
  cgroup.
- Neither the tuner nor the quota watches node memory: the tuner sees only the worker
  container's memory and the quota counts requests. Watch node memory separately.
- `judge_wall_clock_timeouts_total` counts TLEs whose CPU time stayed under the limit;
  `nojv-judge-wall-clock-timeouts` fires on more than two in ten minutes. Lower the
  ceiling when it fires.

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

## Stuck leases and cleanup

- An expired lease is not proof that a sandbox stopped. `reconcileJudgeStage` and
  `judgeCleanupWorkflow` (ID `judge-cleanup-<leaseToken>`) confirm the run's Jobs,
  Pods, ConfigMaps and PVCs are gone before the lease is released.
- Match run ID, Pod UID and CRI/cgroup identity before any directed host cleanup; do
  not restart k3s or containerd to clear remnants.
- Cancel a workflow rather than terminating it so its cleanup runs.
