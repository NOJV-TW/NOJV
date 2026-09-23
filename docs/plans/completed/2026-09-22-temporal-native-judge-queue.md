# Temporal-native judge queue

Status: shipped in v1.3.0–v1.3.9 (2026-09-22); the capacity tables were dropped
on 2026-09-23.

## Why

On 2026-09-22 a 789-execution incident rejudge collapsed judging: 785
`durableJudgeWorkflow` executions each woke every 30 seconds to ask a single
`judgeAdmissionWorkflow` coordinator for their FIFO turn and later for every
per-wave permit. The judge worker replayed 1,500-event histories out of a
32-entry cache for almost every workflow task, the `judge-capacity-v1` workflow
task queue sat at a 700-task / 16-minute backlog, and one submission's
consecutive test cases were 20 minutes apart. The rejudge drained at 19 cases per
hour while three live student submissions waited behind it.

Measured on the same host: a wave (one Kubernetes Job, one case) costs 10.2 s
median (pod scheduling and startup 8.9 s, cleanup 1 s); the case itself uses
125 ms of CPU. Orchestration is 80 times the work.

The structural causes are independent of the incident:

- The queue lives in Temporal histories: one live workflow per queued execution.
- The scheduler is a workflow: every permit is a signal round trip through a
  single history that grows by megabytes and is replayed on cache misses.
- Under contention each student receives one execution unit per wave, so a
  100-case submission becomes 100 Jobs.
- Live submissions, practice and bulk rejudges share one queue with no priority.
- Sandbox capacity is a fixed 5-CPU quota with no exam-time adjustment.

## Design

Temporal already is the durable queue. Use its task-queue priority and fairness
and delete the custom coordinator. (An earlier note here claimed priority was
verified on the production server; that probe ran on the CLI dev server, which
serves FIFO unless `matching.useNewMatcher` is set, and the stage activities
did not carry priority at all. Both were fixed in PR #510 and priority was then
verified on prod; see the stress test in
[Load-aware judge slots](2026-09-22-judge-slot-tuner.md#stress-test-2026-09-22).)

```
submission / rejudge ──► JudgeExecution row (durable fact, outbox)
   └─► durableJudgeWorkflow on task queue "judge"
         priority { priorityKey, fairnessKey: studentId }   (activities inherit)
         └─► executeJudgeStage activity per JUDGE_STAGE_CASES cases:
               one Kubernetes Job, one container per case
               (cgroup memory.peak stays exact), heartbeats + lease
judge worker: maxConcurrentActivityTaskExecutions = WORKER_CONCURRENCY (= Jobs in flight)
```

### Priority

`priorityKey` is computed from the execution and its submission:

| Work                                     | key |
| ---------------------------------------- | --- |
| Submission inside an exam                | 1   |
| Submission inside a contest              | 2   |
| Practice or assignment submission        | 3   |
| Recovery epoch of any live submission    | 4   |
| Rejudge or any `queueClass = background` | 5   |

`fairnessKey = studentId`. Fairness needs `matching.enableFairness: true` in
the self-hosted dynamic config; priority is on by default. Within one key,
dispatch is FIFO. Default `priorityKey` is 3, so an unmapped path degrades to
practice priority, never to the front.

### Capacity

Capacity is the judge worker's activity slot count (`WORKER_CONCURRENCY`). One
slot runs one stage Job of `JUDGE_STAGE_CASES` cases. The sandbox `ResourceQuota`
stays as the hard safety net and must fit
`WORKER_CONCURRENCY × max(K8S_CPU_REQUEST, K8S_MAX_PARALLEL_CASES × K8S_CASE_CPU_REQUEST)`;
a Job the quota can never hold fails as `infeasible` (existing
`findSandboxQuotaViolation`), a Job it cannot hold right now waits as
`waiting_capacity`. Exam-time scaling is a values change (concurrency, quota),
not a code path.

### Per-student ordering

An execution is dispatched only when its student has no other dispatched,
non-terminal execution; finishing an execution dispatches the student's next.
This replaces the FIFO activity loop, keeps "earlier submission judges first",
and makes fairness a refinement rather than a requirement.

### Execution

`executeJudgeStage` keeps the baseline executor (`runPerCasePod`: one Job, one
container per case, `JUDGE_STAGE_CASES` cases per stage) with the existing lease
heartbeat; a saturated worker therefore still interleaves submissions at stage
granularity. Subtask early exit is a follow-up. Retries and recovery keep the
current `JudgeExecution` journal, `reconcileJudgeExecutions` and
`judgeCleanupWorkflow`; capacity-specific recovery (permits, prepared artifacts,
`recoverCapacityRuns`) is removed with the coordinator.

### Deleted

`judgeAdmissionWorkflow`, `judge-capacity.ts` state machine, `durable-capacity.ts`
(FIFO and permit loops), `judge-control.ts` activities, pinned-attempt activities
in `judge-stages.ts`, `judge-quota.ts`, `scripts/judge-release.ts`, the
`claimJudgeStage` slot claim and `waiting_capacity` polling, chart flags
`K8S_CAPACITY_ADMISSION` and `JUDGE_CAPACITY_ROUTING`, the `worker-control`
Deployment and `WORKER_MODE=control`, the `judge-capacity-v1` and `judge-control`
task queues. `JudgeAdmission` and the capacity columns are dropped in a follow-up
migration after the rollback window.

### Kept

`JudgeExecution` journal and lease, immutable snapshots and generations, rejudge
batch workflow, cleanup reconciliation, cron parents (#483), verdict/scoring
effects, browser-local sample runs.

## Rollout

The 774 incident rejudges that had not claimed a lease were deferred on
2026-09-22 (`nextAttemptAt = now() + 7 days`) and their queued workflows
cancelled; the ten in flight finish on the old path. Live submissions therefore
judge normally on v1.2.2 while this lands.

1. Deploy the Temporal dynamic config change (`matching.enableFairness`) ahead of
   the application; it is inert without fairness keys.
2. Deploy v1.3.0; no capacity workflow remains queued. Terminate
   `judge-admission-v1` after the control Deployment is gone.
3. Canary with dedicated accounts across standard, checker, interactive and
   special_env.
4. Release the deferred rejudges (`nextAttemptAt = now()`); the reconciler
   re-dispatches them as recovery epochs at priority 5 behind any live work.
5. Watch judge task-queue backlog age, per-priority start latency, slot
   occupancy, worker memory and sandbox cleanup for the first hour.

Rollback: redeploy v1.2.2 chart and images; executions are database rows and
are re-dispatched by the reconciler. No schema change ships in v1.3.0.

## Verification

- Unit: priority mapping, dispatch start options, chart rendering without the
  capacity flags.
- Temporal integration on a real dev server (`TestWorkflowEnvironment.createLocal`,
  server 1.31; the time-skipping test server does not implement priority):
  priority-1 execution starts ahead of queued priority-5 executions. Database
  integration: a student's second submission waits for the first and is handed
  off when it finishes; cancellation and recovery epochs clean up leases.
- Kubernetes integration (existing nightly): per-case Job isolation and cleanup;
  quota rejection surfaces as a retry not a system error.
- Local: `docker-compose.yml` Temporal 1.31.1 with fairness enabled so
  development matches production.

## Milestones

- [x] Design reviewed; compose and chart Temporal config aligned.
- [x] Dispatch with priority and per-student gate; coordinator removed.
- [x] Unit, Temporal and database regressions green; docs and runbook replaced.
- [x] v1.3.0 released; the deferred rejudge drained 791 executions with no SE.
- [x] Follow-up: migration `20260923020000_drop_judge_admission` drops
      `JudgeAdmission` and `JudgeExecution.capacityStrategy`.
- Subtask early exit was considered and declined (2026-09-23): students keep
  seeing every case's result.

## References

- [Judge pipeline](../../architecture/JUDGE_PIPELINE.md)
- [Reliability](../../operations/RELIABILITY.md)
- [Judge queue runbook](../../runbooks/judge-queue.md)
