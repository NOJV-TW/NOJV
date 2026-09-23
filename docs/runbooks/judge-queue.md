# Judge Queue

Judging is ordered by Temporal task-queue priority and bounded by the judge
worker's Activity slots. There is no scheduler workflow to inspect or signal.

## Inspect

```bash
temporal task-queue describe -t judge
temporal task-queue describe -t judge-state
temporal workflow list --query 'WorkflowType="durableJudgeWorkflow" AND ExecutionStatus="Running"'
```

`judge` carries only sandbox Jobs; `judge-state` carries the quick bookkeeping
activities and should never hold a backlog. The Temporal server must keep
`judge`, `judge-state` and `platform` at one partition (below); with the default
four, a few pollers leave tasks in unpolled partitions for up to a long poll.

`JudgeExecution.state`, `reasonCode`, `nextAttemptAt` and `lastProgressAt` in
the database describe queued and recovering work; `waiting_capacity` means the
sandbox quota rejected a Job and the execution retries every 30 seconds.

## Priority and fairness

| Work                                    | priorityKey |
| --------------------------------------- | ----------- |
| Exam submission                         | 1           |
| Contest submission                      | 2           |
| Practice or assignment submission       | 3           |
| Recovery epoch of a live submission     | 4           |
| Rejudge or any `background` queue class | 5           |

`fairnessKey` is the student ID. The workflow passes its own priority to its
stage activities explicitly. Priority needs the priority-aware matcher: set
`matching.useNewMatcher` explicitly (the CLI dev server v1.7.2 serves FIFO
without it); fairness requires `matching.enableFairness` in the Temporal dynamic config (compose mounts
`infra/docker/temporal-dynamic-config.yaml`; on the official Helm chart set
`server.dynamicConfig` and let the config reload). Without fairness, dispatch
inside one priority is FIFO, and the per-student dispatch gate still prevents one
student from occupying more than one slot.

## Capacity

Slots are `worker.judge.concurrency` times judge replicas. Each slot runs one
stage Job whose run container requests and is limited to
`worker.sandbox.runParallelism` CPUs, so slots × runParallelism is the number of
cases judging can run at once, and the chart fails to render when it exceeds the
sandbox quota's `requestsCpu`. The executor lowers a stage's parallelism when the
problem's memory limit would push the run container past the sandbox memory
ceiling. The node's allocatable CPU minus the platform pods' requests also bounds
how many Jobs schedule at once. Raise concurrency and quota together before an
exam and lower them afterwards; all of these are Helm values.

With `worker.judge.minConcurrency` set (single-machine: 2, ceiling
`worker.judge.concurrency` 5) the judge worker uses Temporal's resource-based
slot tuner: above the minimum it hands out another slot whenever node CPU is
under 75% and the worker's own memory under 80%. Every poll reserves a slot
first, so the SDK's default 50 ms ramp is kept: a long ramp throttles polling
itself (a 10-second ramp judged one task every 10 seconds on an idle node). The judge
container therefore has no CPU limit, because with one the tuner would measure
the worker's cgroup instead of the node. The ceiling is the core budget: each slot is one run
container of `runParallelism` CPUs. Neither the tuner nor the quota watches the
node's memory: the tuner's memory signal is the worker container's own usage, and
the quota counts requests, not usage. `judge_wall_clock_timeouts_total` counts TLEs whose CPU time stayed
under the limit; the `nojv-judge-wall-clock-timeouts` alert fires when more
than two land in ten minutes, which is the signal to lower the ceiling.

## Bulk rejudges

Rejudges are `background` and dispatch at priority 5 behind every live
submission. To park a bulk rejudge, set its executions' `nextAttemptAt` into the
future and cancel their workflows; the lifecycle reconciler re-dispatches them
as recovery epochs once `nextAttemptAt` passes. Park and release whole students
at a time: the dispatch gate orders a student's executions by `createdAt` and
ignores `nextAttemptAt`, so a released execution waits behind any earlier parked
one of the same student. A hand-off to a row whose epoch-0 workflow was
cancelled is a no-op (`REJECT_DUPLICATE`); the reconciler bumps its epoch within
5 minutes, 100 rows per run. Never edit scores or verdicts to unblock a queue.

## Stuck leases and cleanup

An expired lease is not proof that a sandbox stopped. `reconcileJudgeStage`
and `judgeCleanupWorkflow` (workflow ID `judge-cleanup-<leaseToken>`) confirm
that the run's Jobs, Pods, ConfigMaps and PVCs are gone before the lease is
released; match run ID, Pod UID and CRI/cgroup identity before any directed host
cleanup. Cancel a workflow rather than terminating it so its cleanup runs.
