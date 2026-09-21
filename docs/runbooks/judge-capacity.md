# Judge Capacity Operations

Use this runbook for the staged judge's capacity controller, quota ownership,
cleanup incidents and release gates. The design lives in
[Judge Pipeline](../architecture/JUDGE_PIPELINE.md#capacity-admission-and-fairness);
invariants live in [Reliability](../operations/RELIABILITY.md#sandbox-cleanup-pending).
This procedure does not authorize a production load test or runtime restart.

## Current Release Boundary

`worker.sandbox.capacityAdmission.enabled` defaults to `false`. With it disabled,
the existing executor and Helm-managed fixed quota remain active. With it enabled,
the chart adds a separate control-worker Deployment, staged standard/checker
attempts on `judge-capacity-v1`, and controller-managed quota after explicit
activation. `worker.sandbox.capacityAdmission.routingEnabled` independently
starts the control worker and routes web/platform dispatch through its durable
update while retaining the legacy judge queue and static quota. Both flags
default to false; enabling admission also enables routing. Interactive and
Advanced Mode keep their execution contracts under the same admission budget.

The 100-person/60-second performance gate and complete fault matrix are
**pending**. Bounded local gVisor integration passed; it does not replace these
gates. Unit tests, manifest rendering and source inspection do not replace them. Keep the feature disabled in production until the evidence below
is attached to the release. Read current image digests, installed chart values,
Temporal namespace and live quota before acting; do not infer deployment state
from this repository's defaults.

Capacity and baseline workers both execute `durableJudgeWorkflow` from the
immutable `JudgeExecution` snapshot. Capacity attempts record actual completed
case indices and retain the artifact lease between waves. The persisted strategy
follows an execution across recovery epochs; disabling general routing does not
send checkpointed capacity work to the baseline. Drain all such executions before
stopping the capacity worker. A result already committed remains preserved while
its score and notification effects finish.

## Inspect and Pause Admission

The control worker starts workflow type `judgeAdmissionWorkflow` with workflow ID
`judge-admission-v1` on task queue `judge-control`. A newly created workflow has
`paused: true`, `quotaManaged: false`, and `quotaReady: false`. Restarting the
worker resumes the existing workflow and does not reset those fields.

Use the authenticated Temporal UI or SDK against the verified namespace. These
are the exact implemented operator contracts, not shell command names:

| Operation                          | Temporal contract            | Argument |
| ---------------------------------- | ---------------------------- | -------- |
| Inspect                            | Query `admissionState`       | None     |
| Pause new permits                  | Signal `pauseJudgeAdmission` | `true`   |
| Enable quota ownership after drain | Signal `activateJudgeQuota`  | None     |
| Resume permits after validation    | Signal `pauseJudgeAdmission` | `false`  |

Query results include `paused`, `quotaManaged`, `quotaReady`, `quarantinedNodes`,
and `admission` state: the latest capacity snapshot, pending requests, registered
runs and permits. A permit with `cleanupConfirmed: false` is still committed.
Check snapshot age against its `observedAt` timestamp; more than 90 seconds old
blocks new admission. No successful refresh must be synthesized after an API
failure. Request/run IDs are operational evidence; retain inspection exports
privately rather than adding these identifiers to metric labels.

The workflow also uses `registerJudgeRun`, `requestJudgeAdmission`,
`judgeAdmissionReply`, `releaseJudgePermit`, `cleanupJudgeRun`, `cancelJudgeAdmission` and
`finishJudgeRun` internally. Do not signal these manually to force a queue to
advance: a release or finish signal asserts successful resource cleanup. There
is no lease-expiry override and no operator signal to clear node quarantine.

`pauseJudgeAdmission(true)` stops all new permits, including the next wave of a
prepared submission. It allows already executing activities to finish, but is
not itself a full-workflow drain command. Existing accepted submissions remain
in Temporal. Keep the control worker running so cleanup can complete.

## Activity Timeout Recovery

For a capacity execution, a heartbeat, start-to-close or schedule-to-close
timeout does not establish that the Activity
producer stopped. The submission Workflow retains its current permit and waits
before cleanup, release or retry. A schedule-to-start timeout has no executing
producer and does not need this wait. Drain existing executions before enabling
the new strategy.

Query `judgeExecutorRecovery` on the affected **submission Workflow**, not the
admission coordinator. A non-null response identifies the pending `runId`,
`permitId` and available Activity/worker identity. Establish that the old
Activity process can no longer create Kubernetes resources or write temporary
objects: inspect its Temporal Activity and exact worker process/Pod UID, and
perform a scoped worker recovery when necessary. Heartbeat expiry, a lease
expiry, an empty Kubernetes list, or an Activity disappearing from the pending
list is insufficient evidence by itself.

After the producer has definitively stopped, signal `confirmJudgeExecutorStopped`
on that same submission Workflow with exactly `{ "runId": "...", "permitId":
"..." }` from its current query. An early or mismatched acknowledgment is ignored.
This only permits the ordinary UID-fenced cleanup to proceed; it is not an
assertion that sandbox processes have already stopped and does not directly
release admission capacity. Confirm cleanup, CRI/runtime state where relevant,
and subsequent queue progress. Keep the old producer stopped throughout
recovery. Never use `releaseJudgePermit` or `finishJudgeRun` as an operator bypass.

If a cancelled execution's Workflow was terminated before it obtained a database
lease, inspect the coordinator's `runOwners` and unfinished run for that exact
execution ID. A missing database lease does not establish resource absence. Start
`judgeCleanupWorkflow` on `judge-control` with `{ executionId, workflowId,
leaseToken, capacity: true }`, where `workflowId` is the recorded old owner and
`leaseToken` is that run's UUID. The cleanup Workflow checks that pair against
the persisted coordinator ledger. Query its `judgeExecutorRecovery`, establish
the producer-stop proof above, and acknowledge its exact recovery identity there.
Only normal scoped cleanup may then retire the run. Do not guess an owner or
derive authorization from a lease deadline.

## Protected Quota Handoff

Merge and activation are separate gates. The implementation can merge with both
flags disabled while performance and fault acceptance remain open. An announced
maintenance window allows web downtime; it does not authorize dropping accepted
submissions, deleting grades or replaying staged histories with an older binary.
Record the approved start/end time and use dedicated benchmark accounts/data.

1. Save current immutable images, Helm values/manifest, quota, RuntimeClass,
   StorageClass and relevant Workflow histories. Inventory accepted/executing
   submissions and runtime remnants. Resolve leaks before measuring capacity.
2. Deploy the disabled implementation first. Confirm `helm.sh/resource-policy:
keep` on `sandbox-quota` in both the installed Helm manifest and live object.
   This protects quota when the enabled chart stops rendering it. No interval
   may have no quota.
3. Set `routingEnabled=true`, keeping `enabled=false`. The new coordinator starts
   paused with legacy routing. Execute `hold` after the controller is ready:
   subsequent accepted work is durably started on `judge-capacity-v1` and cannot
   execute yet. Existing legacy workers continue
   on `judge`. Confirm every dispatch caller has the new routing environment;
   if operating during maintenance, keep public traffic closed until cutover
   verification completes. For a web-up transition, separately verify there are
   no pending schema migrations and set `migrator.releaseWindow=false`. The
   default upgrade templates can render zero web replicas even if the migrator
   script has no migration to apply.
4. Inspect coordinator state and wait for all old judge/rejudge Workflows and
   execution Activities to finish. Verify their Jobs, Pods, runtime processes
   and cgroups are gone. Do not force old histories onto the new queue.
5. Set `enabled=true`. The judge Deployment uses `Recreate` and now polls
   `judge-capacity-v1`; old workers must have stopped polling. The retained
   static quota stays active until explicit controller activation. Signal
   `activateJudgeQuota`, wait for `quotaManaged=true`, `quotaReady=true`, a fresh
   snapshot and the correct live quota, then signal `pauseJudgeAdmission(false)`.
   Dispatch remains on `hold`, so these steps alone do not admit queued work.
6. After acceptance gates are satisfied, execute `route-capacity`. This update
   atomically enables dispatch and ends drain mode. Perform dedicated-account
   smoke submissions, check completion and cleanup, then restore student traffic.
   Resuming admission admits all eligible queued work: do not call this an
   isolated canary if genuine submissions are already waiting.

Operator CLI (uses the configured Temporal address/namespace and credentials):

```bash
pnpm exec tsx scripts/judge-release.ts --command status
pnpm exec tsx scripts/judge-release.ts --command hold
pnpm exec tsx scripts/judge-release.ts --command route-capacity
pnpm exec tsx scripts/judge-release.ts --command begin-rollback
pnpm exec tsx scripts/judge-release.ts --command verify-rollback
pnpm exec tsx scripts/judge-release.ts --command finish-rollback
```

`hold` requires paused admission with no active staged submissions. Hard pause
stops later waves too; use `begin-rollback` to drain active submissions. Keep admission unpaused and the
control/staged workers running: active submissions finish later waves and
replacement attempts; never-admitted submissions clean up and continue as new
onto the unpolled `judge` queue. New submissions route directly to that queue.
Do not start old workers until `verify-rollback` succeeds.

Rollback verification fails closed on pending/held permits, active submissions
(including teacher rejudge executions), in-flight dispatch, an unavailable workflow ledger, active
staged histories, or a redirected legacy history already consumed by a worker.
It checks persisted histories, not just eventually consistent visibility. It
does not prove CRI/cgroup disappearance; independently verify runtime cleanup.
Run `finish-rollback` to recheck readiness and relinquish dynamic quota ownership.
It waits for an in-flight quota write, then durably leaves admission paused and
quota management disabled; a restart cannot resume quota writes. Independently
verify no old worker is polling: a history check cannot prevent a future poller
from starting. Stop candidate pollers, restore the static quota, and disable both
flags before resuming baseline workers. The baseline must support the immutable
`JudgeExecution` journal and `durableJudgeWorkflow` introduced by PR #471. The
simplest strategy rollback keeps the verified new binary with capacity disabled.
An older production image that predates that journal is not a valid rollback
target, even if it was the previous deployment.

Leave the database, submission source objects and completed grades intact.
Untouched continuations carry only their execution ID in fresh histories; verify
the selected baseline binary can consume them. Retain evidence of accepted IDs
and grades before/after rehearsal. Maintenance deployment still drains active
executions before changing queue consumers; it does not require mixed-version
history compatibility.

## Cleanup Pending and FailedKillPod

When capacity is exhausted, verify that accepted executions remain queued and
resume after capacity returns, including after more than three quota rejections.
The coordinator distributes one unit per ready student before expanding waves
within CPU/memory budgets. Six available one-CPU slots may therefore produce
one six-case wave or two three-case waves, subject to memory and Pod overhead.
Existing waves finish before their allocations can change.

Check Node conditions alongside the capacity snapshot. MemoryPressure,
DiskPressure and PIDPressure (True or Unknown) stop new admissions on that node;
clearing the condition restores eligibility at the next successful refresh.
Do not increase concurrency from free RAM alone, and do not treat DiskPressure
as an IOPS measurement. Quota waiting, node-pressure waiting, runtime quarantine
and malformed-result SE are different failure paths and require separate evidence.

1. Query coordinator state and correlate the affected run with structured worker
   logs, the Job owner UID, Pod UID, node, and `cleanup_pending` resources.
   Preserve the original error. Do not send a permit-release signal or mark
   cleanup complete because a deletion request returned successfully.
2. The normal deletion budget is 30 seconds. Durable cleanup retries continue
   after that budget. An API outage or changed UID must remain a failed cleanup
   attempt. Check that the control worker and API are reachable, and that
   `judge_cleanup_pending_total` / quarantine alerts reach the intended operator.
3. Repeated `FailedKillPod` events with count at least three add the node to the
   coordinator's persistent `quarantinedNodes` set. Confirm it receives no new
   permits while other eligible nodes continue. A pause is available if the
   incident affects the whole cluster; do not reduce held reservations to fit
   the now-smaller capacity snapshot.
4. For known stuck runtime resources, inspect the affected host read-only first.
   Match the current Pod UID through the CRI sandbox/container inventory,
   containerd shim and runsc command lines, and the Pod/container cgroup paths.
   Recheck process identity immediately before any scoped intervention; old
   PIDs and old inventory files are insufficient. Inspect CPU/memory/IO counters
   to distinguish a live leftover sandbox from a stale API record.
5. Apply only the reviewed, run-owned runtime recovery action. Do not bulk kill
   runsc/shims, force-delete unrelated Pods, or restart k3s/containerd as an
   automatic response. Verify the specific processes and cgroup disappear,
   then verify PVC/Job/ConfigMap and temporary result cleanup completes.
6. Keep quarantine until runtime recovery is demonstrated. There is currently
   no built-in quarantine-clear signal: restoration needs a separately reviewed
   coordinator-state recovery that preserves active permits and queued work.
   Do not terminate/recreate the coordinator to erase its accounting state.

Successful containment or targeted cleanup does not establish that the runsc
internal defect was fixed. Record the unresolved runtime cause separately.

## Acceptance Evidence

- Existing verdict fixtures across all supported languages and standard,
  checker, interactive and advanced modes; 1/20/100-case integrity, compile-once
  behavior, answer isolation, artifact tampering and output-limit checks.
- Docker isolation and protected K8s/gVisor integration runs, including
  cancellation at each stage, worker/coordinator restart, duplicate signals,
  stale capacity, node drain/loss, artifact loss and repeated `FailedKillPod`.
- No premature permit release, stale generation result, leaked PVC/Job/ConfigMap,
  temporary object, sandbox process or cgroup; no normal queue timeout or student
  starvation. Save replay evidence for the exact old and candidate workflows.
- The [benchmark procedure](testing.md#judge-capacity-benchmark) with fixed image,
  fixtures and background load: cold/warm repetitions, 100 distinct students
  accepted within 60 seconds, at least 20% median burst drain improvement and no
  more than 10% single-submission/web p95 regression. Missing queue/CPU/runtime
  evidence remains missing; do not fill it with inferred zeroes.
- Real multi-node correctness/availability evidence. Simulated nodes sharing
  one host are not proof of scale-out throughput.

Run production-host benchmarks only in an approved maintenance window with real
judging drained and dedicated test accounts/data. Retain verified cleanup and
measurement fixes if the resource strategy fails its gates. Do not loosen
isolation, problem limits or verdict rules to achieve the performance target.
