# Sandbox quota recovery

**Status:** Implemented and locally checked in draft [PR #471](https://github.com/NOJV-TW/NOJV/pull/471). The PR records full-suite results and current-head CI; production rollout remains pending. The approved recovery contract below supersedes the original quota-only scope.

**Goal:** Capacity contention delays judging. Infrastructure failures recover automatically against the original version; infeasible configuration remains visible and retryable without fabricating a program verdict.

**Architecture:** PostgreSQL stores immutable execution ownership, version pointers, dispatch intent and stage checkpoints. Temporal retries and reconciles that execution; shared 4:1 admission precedes Kubernetes or Docker execution. Sandbox cleanup must be confirmed before a lease can be reused.

**Tech stack:** PostgreSQL/Prisma, S3 immutable objects, Temporal TypeScript SDK, Kubernetes/Docker, Vitest and Playwright.

## Approved recovery contract (2026-09-21)

- Capacity shortage waits; a real infrastructure outage may show SE. Recovery is system-owned and resumes the original immutable judge version. Only a teacher-requested rejudge selects the latest effective version. Editing a problem alone never changes an existing execution.
- Persist accepted input, version, ownership and dispatch before acknowledging acceptance. Never cancel accepted durable work because Temporal start is slow.
- Persist stage checkpoints, fence stale attempts, reconcile dispatch and execution progress every minute, and retain failures with a reason and a next recovery time.
- Use foreground/background 4:1 admission, FIFO within each class, and loan unused admission capacity. Never reclaim sandbox capacity until resource cleanup is confirmed.
- Teacher rejudge preserves the last valid result until replacement commits. System recovery does not create teacher rejudge logs or silently change versions.
- Unknown historical versions must be reported as blocked, never guessed from today's problem data.
- Worker self-recovery only; runtime/node restart remains an operator action.

## Execution checklist

- [x] Durable acceptance, immutable judge snapshots, execution ownership, teacher rejudge/version separation.
- [x] Pod-start/capacity/eviction/cleanup classifications and regression tests.
- [x] Durable workflow recovery, bounded history, progress checkpoints and fair capacity admission.
- [x] Reconciliation, worker health, execution API/UI and real alert metrics.
- [x] Fault injection, burst/drain and history rollover tests; `ci:verify` and independent review.
- [x] Reviewable draft PR with validation evidence.
- [ ] Production deployment, runtime recovery, external alert delivery and historical recovery acceptance.

## Expanded implementation evidence (2026-09-21)

- Accepted submissions commit source, immutable judge snapshot, generation/owner and durable dispatch together. A never-resolving Temporal handoff cannot turn acceptance into SE.
- Real PostgreSQL tests cover version pinning, teacher-only version replacement, 4:1 FIFO admission, stale-owner rejection, atomic terminal checkpoints, recoverable finalization, log retention, deletion safety, workflow loss and blocked legacy submissions. Legacy dispatch consumers retire snapshotless messages, and stale legacy abandonment atomically cancels outstanding initial dispatch. Missing/closed workflows are not terminated based on an outdated observation.
- A real local Temporal server exercised 100 mixed submissions (80 foreground, 20 background), 41 cases each and 300 checkpoints through production activities and PostgreSQL admission. Both judge workers were stopped and recreated after checkpoints. All submissions completed once, every stage ran once, old images/limits stayed pinned after live configuration edits, and all leases drained. The measured test took 44.47 seconds. The sandbox and blob adapter were controlled fixtures; this is not a Kubernetes throughput benchmark or an abrupt process-kill experiment.
- Temporal fault tests cover capacity pressure beyond the old retry budget, repeated machine failures, finalization retry without rerunning the sandbox, and Continue-As-New carrying only the execution reference.
- Real local Kubernetes: 15/15 tests passed (166.70 seconds), including occupied quota release, permanent infeasibility classification, standard/checker/interactive/Advanced judging and cleanup. The local cluster is k3s; production gVisor/runtime failure injection remains a rollout check.
- Actual Chromium: 4/4 tests passed (24.9 seconds), using real local web/auth/PostgreSQL/S3. Verified capacity waiting, SE polling back into waiting, missing-version messaging, and an existing AC/100 result retained during teacher rejudge. Screenshots were inspected. This targeted test does not run the judge or the full E2E suite.
- Database-backed metrics and alert rules now cover queue age, blocked/stalled execution, legacy SE and observer failure. External Grafana provisioning and alert delivery have not been exercised.
- Independent contract and code-quality reviews approved the final fixes. A real PostgreSQL row-lock race proves cancellation cannot be resurrected by a concurrent admission claim; the claim uses a conditional update and advances the fairness cursor only on success. The final affected-domain run passed 38/38 tests.
- Final local `pnpm ci:verify` passed: formatting/guards, builds, application and test typechecking, lint, 3,298 unit tests and 61 component tests. Helm lint passed for the single-machine production fixture. Full integration outcomes and current-head CI are recorded in [PR #471](https://github.com/NOJV-TW/NOJV/pull/471); these remain distinct from the local checks above.

## Evidence and constraints

- Production v1.1.21: 787 quota-related SE submissions, 70 users, 3 problems, 1 exam; created 2026-09-21 10:32–11:12 Asia/Taipei.
- Each 20-case wave requests 2 CPU; namespace quota is 4 CPU; worker activity concurrency is 4.
- `isDeterministicAdmissionFailure` matches `forbidden` in a normal `exceeded quota` rejection. Sandbox activity retries three times, then persists SE.
- A later sandbox stuck terminating is a separate runtime incident; no force deletion or node restart is part of the code fix.
- Original quota-only scope excluded schema and scheduling changes. The approved recovery contract above supersedes that restriction; quotas remain unchanged.
- References: [Judge pipeline](../../architecture/JUDGE_PIPELINE.md), [Reliability](../../operations/RELIABILITY.md), [Testing](../../runbooks/testing.md), [Kubernetes quotas](https://kubernetes.io/docs/concepts/policy/resource-quotas/).

## Implementation and verification

1. Add executor regressions for the exact quota message, capacity recovery, quota remaining unavailable, deadline before Pod creation, cancellation, and real admission rejection. Run before/after the fix.
2. Classify quota pressure before generic forbidden errors. Preserve waiting and return persistent pressure as `SandboxBackpressureError`.
3. Handle capacity pressure with cancellable durable workflow backoff. Correct the sandbox admission non-retryable policy; retain three attempts for other failures. Test more than three pressure cycles, cancellation/rejudge restore, and permanent/generic failures with Temporal's test server.
4. Add and run a real Kubernetes ResourceQuota contention/release regression in the isolated local k3d test namespace, including cleanup evidence.
5. Run worker regression tests, relevant integration tests, typechecking, lint, formatting, and repository verification. Inspect the final diff and update living docs.
6. Prepare a reviewable PR. Production rollout requires exact release identity, healthy workers, sustained quota-pressure recovery without new quota SE, and evidence that the stuck sandbox is resolved. Historical records without original snapshots remain blocked. Only an explicit teacher rejudge may evaluate them with the latest version; verify new verdicts and scores separately.

## Historical quota-only verification (before expanded implementation)

- Reproduced the production quota rejection in failing regression tests before fixing it. Covered direct API quota rejection for sandbox resources, controller `FailedCreate` events, persistent contention, cancellation, and cleanup failure.
- `pnpm ci:verify` passed: formatting, repository guards, builds, typechecking, lint, 3,234 unit tests, and 61 component tests.
- Temporal integration suite: 12 tests passed, including recovery after more than three capacity failures, cancellation during a capacity wait, permanent admission failure, and replay of a pre-fix workflow history. The sanitized replay fixture was generated from commit `507f1542` with the Temporal test server. These tests use no database; the targeted run omitted the unrelated destructive database setup.
- Real local Kubernetes suite: 15 tests passed, including four concurrent submissions blocked by an occupied ResourceQuota and a sustained quota rejection that crosses the executor/Temporal boundary, cleans up, waits, and succeeds on a fresh attempt. Only the cluster's standard root CA ConfigMap remained after the suite.
- The local cluster uses k3s, not production's sandbox runtime and network configuration. This verifies executor behavior under real Kubernetes admission, not production isolation or live recovery.
- The first review findings on workflow replay, cleanup failures, and direct Advanced sidecar quota rejection were fixed. The broader follow-up audit below supersedes that review's scope and identifies further blockers.
- At 11:39 Asia/Taipei, a read-only production query still identified 787 affected submissions. A local restricted inventory records submission IDs and generations for later revalidation; no user code or credentials are included.

## Remaining rollout gates

- Review and ship the repair; verify the deployed worker image digest and source revision.
- Verify runtime health, resource cleanup, and capacity recovery under production traffic for at least 15 minutes, with no new quota-related SE. Follow the quota scenario in the incident recovery runbook.
- Revalidate the affected-submission inventory before any audited rejudge; verify resulting verdicts and scores separately.
- Production mitigation, release, and affected-submission rejudge have not been performed. Keep this plan active until the rollout gates are satisfied.

## Follow-up audit: accepted work must survive resource scarcity

Audited source: `74ed305226d3d22e5c5e2ef9194812daf43059e0` (PR #471). At that audit checkpoint production was v1.1.21 and the findings were not repaired. The expanded implementation above addresses these paths locally; production has not been reverified or deployed by this implementation. PR #471 remains draft.

### Current production evidence

At 2026-09-21 12:53 Asia/Taipei, read-only queries found:

- 787 quota-related SE submissions, all at judge generation 1, plus 2 separate interactive-result SE submissions that day.
- No submissions in `pending_upload`, `queued`, `compiling`, or `running` at the observation time. This is not evidence of queue safety under load.
- 2,002 initial dispatch outbox rows and 4 rejudge dispatch rows were `succeeded`; no pending/leased/dead rows in those kinds.
- Subsequent runtime inspection still found the old gVisor prepare Pod terminating. ResourceQuota reported zero used Pods, CPU, and memory; both workers were available on v1.1.21. Node/runtime cleanup remains unresolved independently of quota accounting.

### Confirmed incorrect-SE paths

| Finding                                                        | Trigger and observed behavior                                                                                                                                                                                                                                                                                                                                        | Source / evidence                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1: accepted submission is invalidated by a slow handoff       | Source and dispatch outbox are committed. A failed or >3-second Temporal start cancels the outbox and writes SE. The raced start request is not cancelled, so a late acceptance also makes ownership uncertain.                                                                                                                                                      | `packages/application/src/submission/mutations.ts:82,510`; existing dispatch tests reproduce failure and timeout.                                                                                                                                                                                                               |
| P1: Pod existence is confused with execution                   | An unscheduled Pod plus `DeadlineExceeded` bypasses the no-Pod backpressure guard. A Pod with only `status.startTime`, prepare `ContainerCreating`, and testcase `PodInitializing` is considered started. Both full executor mock-API reproductions return SE with empty logs. A real API that refuses the log read instead exhausts bounded infrastructure retries. | `apps/worker/src/services/k8s-executor.ts:419,1846`; `unscheduled-deadline` and `scheduled-init-deadline` reproductions.                                                                                                                                                                                                        |
| P1: sidecar accepted but unschedulable                         | The sidecar create API succeeds, but its Pod remains Pending with Insufficient CPU. Readiness times out, a generic exception becomes the Advanced fallback SE. The previous PR test covered create rejection only.                                                                                                                                                   | `apps/worker/src/services/k8s-executor.ts:862,898`; full executor `sidecar-unscheduled` reproduction.                                                                                                                                                                                                                           |
| P1: long rejudge is reconciled against the wrong workflow      | Once an open rejudge log is older than the pending timeout, it no longer protects the submission. The sweeper checks `judge-{submissionId}` instead of the active `rejudge-{submissionId}-...` child, clears the active owner and writes SE even if that child is waiting normally.                                                                                  | `packages/application/src/submission/sweep.ts:35,50`; `packages/temporal/src/dispatch.ts:75`; mocked-domain reproduction writes SE and never queries the active child identity.                                                                                                                                                 |
| P1: undelivered durable work is mistaken for abandoned work    | An old queued row with no Temporal execution is marked SE without consulting its pending/leased dispatch outbox. A slow/outage-affected processor can still own a valid retry.                                                                                                                                                                                       | `packages/application/src/submission/sweep.ts:50`; mocked-domain reproduction confirms no outbox lookup before SE.                                                                                                                                                                                                              |
| P1: repeated resource eviction still exhausts a failure budget | Evicted/Preempted/NodeLost become `SandboxInfrastructureError`. Only `SandboxBackpressureError` reaches the durable capacity loop; three infrastructure failures still fail the submission. Cleanup failures currently share that infrastructure error type, so making all such failures retry forever would be unsafe.                                              | `apps/worker/src/services/k8s-executor.ts:1837`; `apps/worker/src/workflows/submission-judge.ts:23,57,150`; classification confirmed in code; real Temporal with injected eviction errors stops at attempt 3 and calls failure persistence, never reaching the recoverable fourth attempt. No real node eviction was performed. |

### Pending / lack-of-progress paths

1. **RUNNING is an ownership state, not a progress signal.** The sweeper skips every RUNNING workflow. A worker that never returns, repeated workflow-task failure, or capacity that never becomes feasible can leave the database nonterminal indefinitely. A characterization test repeats 100 sweeps with identical RUNNING state and observes only skips. Ordinary activity options have no schedule-to-start timeout; that correctly avoids converting worker queue delay into SE, but needs independent backlog and progress monitoring.
2. **Capacity retries have no history rollover.** Every retry schedules `executeSandbox(submissionId, draft)` again. A valid Run draft can contain large inline `runCases`. A real Temporal test environment run with a 1,000,156-byte activity input, 60 backpressure failures, and success on attempt 61 produced 691 events; fetching its history failed because the response was 62,081,596 bytes, exceeding the client's 4 MB receive limit. The Java test server reported COMPLETED and did not enforce the production history limit. Official self-hosted defaults terminate executions above 50 MB or 51,200 events; the production override was not checked. Thus history growth is measured, while production termination is an inference from the documented limit.
3. **A later wave loses earlier progress on retry.** `rawRuns` lives only in one activity invocation. Wave 0 succeeds, wave 1 lacks capacity, and the next activity starts again at wave 0. The reproduction creates `w0,w1,w0,w1`. Repeated work is proven; permanent starvation in a real mixed workload is not yet proven. This also makes the fixed 10-minute activity timeout more relevant for long, multi-wave jobs.
4. **Capacity failure cannot always heal by waiting.** A single manifest that cannot fit the namespace quota or any permitted node cannot ever be admitted under unchanged configuration. Retrying it every 30 seconds produces work, not progress. Request feasibility and operator-visible blocked state must be distinguished from temporary contention.
5. **The stuck alert is not wired to a metric producer.** `nojv-submissions-stuck` references the placeholder `nojv_submissions_stuck`. The existing judge latency histogram is emitted at completion and cannot prove progress when nothing completes. The admin health view can count stale submissions, but is not an autonomous alert/recovery mechanism. A read-only query of the current in-cluster Prometheus returned an empty vector for `nojv_submissions_stuck`; this does not establish the state of every external datasource.
6. **Automatic SE recovery is incomplete.** `recoverSystemErrorSubmissions()` runs at platform worker startup only, selects at most 100 generation-1 SEs in descending creation order, and is not the minute sweeper. It does not guarantee recovery of a large incident such as the 787 rows observed here.
7. **Browser polling expiry is separate.** The client stops waiting after 10 minutes and shows a request timeout. That path does not write a database SE or cancel the workflow; it must not be confused with server-side terminal failure. It needs a clear link back to the accepted submission's continuing status.

### Audit execution evidence

- Domain characterization: 6 tests passed (27 unrelated tests filtered out), confirming the current dispatch failure/timeout policy, long-rejudge wrong-owner reconciliation, ignored outbox ownership, and repeated RUNNING skips. These tests demonstrate defects; they are not evidence of repaired behavior.
- Full executor with mocked Kubernetes responses: three pre-execution capacity scenarios returned SE; two multi-wave attempts repeated the completed first wave.
- Real Temporal history experiment: measured a 62,081,596-byte history fetch response after 61 activities with a large Run draft. Its corresponding request passes the current submission schema and is 1,000,196 bytes, below the 2,097,152-byte HTTP body limit. Production history-limit enforcement was not exercised.
- Real local Temporal server with three injected resource-eviction failures: confirmed failure persistence after attempt 3, without reaching the modeled recovery at attempt 4.
- Real local Temporal server, capacity-wait worker restart: passed. A fresh worker resumed the recorded wait and committed once without re-running submission initialization or writing SE.
- A 100-workflow burst with four worker activity slots and two modeled sandbox slots did not finish within an initial 240-second test window. At the last 225-second sample after capacity release, 96 workflows had completed, zero had failed, and 382 sandbox attempts had been made. The extended run passed: all 100 completed exactly once with zero failure-persistence calls and at most two modeled sandboxes executing concurrently; total test duration was 272.54 seconds. This proves eventual draining for that finite synthetic burst, not fairness under continuous arrivals or measured Kubernetes throughput.
- The initial Java time-skipping burst run failed inside the test server with gRPC/Internal and unbalanced time-skipping-lock errors. That result was excluded from product conclusions; the burst was moved to a real-time local Temporal dev server.
- Additional code-level budget concern: one sandbox activity has a 10-minute start-to-close timeout, while a single Kubernetes Job may permit up to 30 minutes and an activity can contain multiple waves plus checker execution. Heartbeats do not extend start-to-close. Large legitimate workloads and long pre-execution I/O need explicit budget tests; this is not yet a measured production failure.

### Required repair contract

- Once source storage and dispatch intent commit, return the accepted submission identity. A temporary dispatch failure preserves durable delivery rather than converting the accepted record to SE.
- Classify waiting, infrastructure interruption, sandbox cleanup failure, permanent problem/environment configuration failure, and actual program verdict separately. Never turn waiting time into a student execution timeout or verdict.
- Use actual container execution evidence for execution deadlines. Apply the same capacity policy to standard, checker, interactive, Advanced run/grade, sidecar, and volume stages.
- Reconcile the actual active workflow/run and generation, plus dispatch ownership. Preserve healthy queued work and rejudge snapshots; repair a genuinely missing owner through an idempotent durable path. Do not kill by age alone.
- Preserve bounded history and completed progress across capacity retries. Any continue-as-new path must carry rejudge state without taking a new snapshot, incrementing the generation twice, or treating the continue-as-new control flow as failure.
- Export backlog count, oldest accepted age, capacity-blocked count/reason, last progress time, completion rate, and expired ownership from an observer that remains available if judge workers stop. Test the alert datasource and delivery, not just the rule JSON.
- A capacity wait must remain inspectable, cancellable, and recoverable. If resources never return, a completion-time guarantee is impossible: surface an infrastructure-blocked condition and escalate without fabricating a verdict or silently spinning forever.

### Acceptance before releasing a complete repair

- Delayed/failed/late-success Temporal dispatch after database commit: one accepted submission, one effective judge owner, no resource-caused SE.
- Unscheduled Pod, accepted-but-not-started Pod, sidecar Pending, PVC delay, repeated resource eviction, and temporary API outage all preserve accepted work. Permanent malformed judge data and actual program limits retain their intended outcomes.
- A rejudge waits beyond the configured pending timeout, survives several sweeps and worker restarts, then completes once; cancellation restores the prior verdict and score.
- Capacity unavailable then restored: representative bursts and sustained mixed small/large multi-wave jobs drain without starvation, repeated verdict commits, or leaked resources. Measure queue age, attempts, useful progress and throughput; do not infer capacity from a worker count.
- A prolonged wait with the largest permitted draft stays below history limits and does not repeatedly discard completed waves.
- Workflow/outbox disappearance and stalled progress are detected by a functioning alert and repaired without overwriting a newer owner. An infeasible resource request becomes visible to operators and does not spin unattended.
- Only after those checks: immutable production release identity, live runtime cleanup, representative stability window, and separately audited recovery of the affected submissions and scores.

### Reference semantics

- [Kubernetes Pod API](https://kubernetes.io/docs/reference/kubernetes-api/core/pod-v1/): Pod `startTime` precedes image pulling and is not container execution evidence.
- [Temporal activity timeouts](https://docs.temporal.io/encyclopedia/detecting-activity-failures): queue wait and activity execution are distinct; monitoring schedule-to-start latency is preferred over using a queue timeout as failure handling.
- [Temporal self-hosted defaults](https://docs.temporal.io/self-hosted-guide/defaults): history size/event limits.
- [Temporal Continue-As-New](https://docs.temporal.io/workflow-execution/continue-as-new): explicit state transfer into a new history while preserving workflow identity.

### Reproduction artifacts

Local evidence bundle: `/tmp/nojv-queue-audit-20260921.tar.gz`. It contains the audited source SHA, temporary characterization tests, executor/history scripts, selected logs, and reproduction commands. Tests demonstrating existing defects are deliberately kept out of the normal passing regression suite; they must be converted to assertions of repaired behavior during implementation. No production source, verdict, deployment, quota, or node state was mutated by this audit.
