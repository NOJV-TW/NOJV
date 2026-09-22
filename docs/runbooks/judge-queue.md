# Judge Queue

Judging is ordered by Temporal task-queue priority and bounded by the judge
worker's Activity slots. There is no scheduler workflow to inspect or signal.

## Inspect

```bash
temporal task-queue describe -t judge
temporal workflow list --query 'WorkflowType="durableJudgeWorkflow" AND ExecutionStatus="Running"'
```

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

`fairnessKey` is the student ID. Priority is on by default in the server; fairness
requires `matching.enableFairness` in the Temporal dynamic config (compose mounts
`infra/docker/temporal-dynamic-config.yaml`; on the official Helm chart set
`server.dynamicConfig` and let the config reload). Without fairness, dispatch
inside one priority is FIFO, and the per-student dispatch gate still prevents one
student from occupying more than one slot.

## Capacity

Slots are `worker.judge.concurrency` times judge replicas. Each slot runs one
stage Job whose effective request is `max(cpuRequest, maxParallelCases × caseCpuRequest)`
CPU (the compile init container and the case containers never run at once), so
the sandbox quota must hold `slots × that request`. Two more limits gate a Job:
the sandbox LimitRange `min.cpu` must not exceed `caseCpuRequest` (a Job whose
containers request less is rejected at admission and the execution goes
`blocked`), and the node's allocatable CPU minus the platform pods' requests
bounds how many Jobs schedule at once. Raise concurrency and quota together
before an exam and lower them afterwards; all of these are Helm values.

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
