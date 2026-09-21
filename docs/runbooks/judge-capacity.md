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
attempts, and controller-managed quota after explicit activation. Interactive and
Advanced Mode keep their execution contracts under the same admission budget.

The 100-person/60-second performance gate and real gVisor integration acceptance
are **pending**. Unit tests, manifest rendering and source inspection do not
replace them. Keep the feature disabled in production until the evidence below
is attached to the release. Read current image digests, installed chart values,
Temporal namespace and live quota before acting; do not infer deployment state
from this repository's defaults.

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

For histories on the `judge-capacity-cleanup-v1` branch, a heartbeat,
start-to-close or schedule-to-close timeout does not establish that the Activity
producer stopped. The submission Workflow retains its current permit and waits
before cleanup, release or retry. A schedule-to-start timeout has no executing
producer and does not need this wait. Pre-patch histories retain their original
Activity retry contract; drain them before enabling the new strategy.

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

## Protected Quota Handoff

1. Save the current immutable worker/sandbox image references, Helm values and
   manifest, live `sandbox-quota`, RuntimeClass, StorageClass and relevant
   Workflow histories. Inventory pending/executing submissions and any orphaned
   sandbox resources. Resolve existing runtime leaks before using capacity data
   as an admission baseline.
2. First deploy a release with capacity admission **disabled** that adds
   `helm.sh/resource-policy: keep` to `sandbox-quota`. Verify the annotation in
   both Helm's stored installed manifest and the live quota object. Do not skip
   this intermediate release: adding the annotation only to a local chart does
   not protect a quota removed by the next Helm upgrade.
3. Validate old-history replay against the candidate worker before replacing
   judge workers. The `judge-capacity-cleanup-v1` workflow patch preserves the
   old sandbox activity contract for recorded pre-patch execution histories;
   it does not make an old worker understand a newly recorded staged history.
   Prevent old and new binaries from simultaneously consuming the judge queue.
   The candidate judge Deployment uses `strategy: Recreate`; verify this is the
   rendered and applied strategy and that no separately managed old worker is
   still polling. This avoids Deployment rolling overlap, but does not by itself
   establish workflow drain or worker-version routing. Continue web, source
   persistence, Temporal dispatch and platform service throughout replacement.
4. Deploy the enabled candidate while its new coordinator remains paused and
   `quotaManaged` is false. Confirm the control worker is healthy on its own
   queue. New staged submissions should reach workflow admission waits without
   consuming sandbox execution activity slots; previously recorded execution
   histories continue on their compatible branch. A history that had not yet
   recorded execution can follow the new branch. Track actual sandbox work,
   not merely workflow creation dates, to determine what still needs draining.
5. Keep the retained static quota in place while old executor work drains.
   Confirm no legacy Job/Pod or runtime process remains and all corresponding
   old execution activities have completed. Coordinator refresh may observe
   capacity during this period but must not change quota before activation.
6. Signal `activateJudgeQuota` with no arguments. Wait for `quotaManaged: true`,
   `quotaReady: true`, a fresh snapshot, and a live quota matching the controller's
   effective budget. The feature-enabled Helm manifest must no longer render
   `sandbox-quota`. Do not delete and recreate the quota to change its owner;
   keep a live quota throughout the handoff. A failed refresh leaves admission
   blocked until reconciliation succeeds.
7. Complete the acceptance gates below, then signal `pauseJudgeAdmission(false)`
   and perform a small, dedicated-account smoke run before general release.
   A global resume admits every pending eligible request, so do not describe
   this as an isolated smoke if real student work is already queued. Establish
   a reviewed traffic/window boundary or finish synthetic validation on the
   isolated target first.

The standard migrator `releaseWindow` can scale web and workers down for schema
cutovers. That is not this web-up capacity transition. Review the concrete
release's hooks, rollout strategy and Flux reconciliation before applying it;
do not invoke a generic release path that stops submission acceptance.

## Cleanup Pending and FailedKillPod

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

## Rollback Boundary

Pause admission and preserve the current worker/control images while recovering
or draining their histories. A pause stops future waves as well as new runs;
there is currently no dedicated “finish admitted runs, hold new runs” operator
signal. Therefore a full rollback requires a verified drain/version-routing
procedure that can complete all new-history work while keeping newly accepted
submissions safely queued. If that prerequisite is unavailable, keep the
candidate workers available and recover forward; do not force an old worker to
consume incompatible new histories.

Before restoring an earlier executable, prove no new-format history can reach
its task queue, all held permits are cleaned up, and accepted submissions and
completed grades are preserved. Stop the dynamic quota writer only after that
drain, restore the saved Helm-owned static quota while maintaining a live quota,
then restore the earlier judge deployment through the reviewed release/Flux
procedure. Verify ownership, queue progress and synthetic verdicts before
resuming ordinary dispatch. Never use deletion of submissions, reset grades,
manual release signals, or a recreated coordinator as a rollback shortcut.
