# Judge throughput, admission and cleanup

Approved scope: 100 students each submit once in 60 seconds, using the existing
Temporal / Kubernetes / gVisor boundary. Public APIs, verdicts, language factors,
per-case isolation and resource-limit semantics remain unchanged.

## Milestones

- [x] Implement UID-fenced termination-before-release cleanup, durable retry, node quarantine.
- [x] Implement phase measurements and repeatable baseline / comparison tools.
- [x] Implement one compilation per attempt, bounded read-only artifact PVC, fresh case containers.
- [x] Implement durable Temporal admission, registered-student round robin / FIFO, four-case maximum waves.
- [x] Implement 30-second capacity snapshots, 90-second freshness guard and explicit quota handoff.
- [ ] Fault / isolation / integration tests; update living docs and operational runbook.
- [ ] Three cold and three warm repetitions of single, steady and 100 / 60 s workloads.
- [ ] Release gates, controlled drain, canary and rollback verification.

## Invariants

CPU and memory budget per eligible node is allocatable minus the larger of
non-judge effective requests and 25% allocatable. Account for init containers,
restartable sidecars and RuntimeClass overhead. One CPU per case and compilation;
full memory plus existing headroom; compiler memory at least 512 MiB.

Admission waits live in Workflow history, not execution Activities. Holds survive
restarts and expired heartbeats; only confirmed cleanup releases a permit.
Prepared attempts are capped at twice the cluster CPU slots. Each student has at
most one running wave and returns to the queue after each wave. Kubernetes still
places Pods using selectors / affinity and RWO WaitForFirstConsumer volumes.

A run owns its Jobs, Pods, ConfigMaps, PVC and temporary results. Cleanup waits up
to 30 seconds, reports cleanup_pending and retries durably. FailedKillPod stops
new work on that node, without restarting k3s/containerd. Runtime-level remnants
require separate identity-checked operator verification.

## Acceptance and release

Fixed fixtures must retain all verdicts, no leaks / OOM / starvation or stale
queue failures. Median burst drain time improves at least 20%; single-submission
and web API p95 regress by at most 10%. Keep cleanup / telemetry fixes if capacity
changes fail these gates. No production load test during an exam; maintenance
window or dedicated cluster is required. Same-host multi-node tests prove only
functional capacity / failure handling, not scaling performance.

Pause new judge admission (continue accepting submissions), drain old histories,
transfer quota ownership, deploy through CI / version / Flux, smoke-test, resume.
Rollback drains new histories before returning old code and quota; never replay
new histories with the old worker. Preserve accepted submissions and grades.

## Evidence and open gates

- Baseline source: origin/main 820db362, isolated codex/judge-capacity worktree.
- Main checkout contains unrelated submission-history/UI changes, excluded here.
- Node 24.18.0 required (default shell pnpm initially selected Node 26).
- Production maintenance window / dedicated benchmark cluster requested.
- Initial implementation `pnpm ci:verify` passed: build, typechecks, lint, formatting, 373 unit
  files / 3,337 tests and 33 component files / 61 tests.
- `pnpm test:integration:temporal` passed: 4 files / 31 tests, including 20/100
  testcase attempts, cleanup-held admission, cancellation, quota handoff,
  coordinator state restoration, retry FIFO, real 60/120-second ambiguous
  Activity timeouts and synthetic pre-patch history replay.
- Existing Docker isolation / seed fixtures passed: 4 files / 85 tests.
  The new prepared-artifact integration passed 8 language cases / 32 actual
  containers, one compile and publication plus two fresh read-only consumers
  per language, with unchanged artifact hashes and no test-container remnants.
  Image: `sha256:f662da235dd856cb720829ac76bf08f9da1fb1ee0b5c54872fd266ff498a9e12`.
- The unchanged baseline passed 13 K8s unit files / 203 tests. This is a
  correctness baseline, not a throughput baseline.
- Live SSH inspection and targeted cleanup were performed for Pod UID
  `b23ac00d-2269-4432-a090-6dac1d354edd`, run
  `970184cc-2291-4b45-a43c-21fe966ef173`. Its existing deletion had stalled;
  identity was rechecked against Job ownership, CRI sandbox, shim and cgroup.
  Only its owned cgroup was terminated. CRI stop/remove returned success;
  original processes, shim, cgroup and API Pod were absent afterward. No
  k3s/containerd restart occurred. A subsequent live check found no sandbox Pods
  and the expected Ready replica counts for web, judge and platform workers.
  The runsc internal root cause is unresolved.
- Follow-up local validation is authorized with task-owned PostgreSQL/Redis
  containers and a disposable k3d cluster; existing development/production
  databases are excluded. Prisma consent applies only to the marked test DB.
- Real Kubernetes testing exposed a deletion-options bug: putting propagation
  in the query while supplying UID preconditions in the body orphaned Pods.
  Both now live in the DeleteOptions body. The same gVisor case changed from
  a 30-second cleanup timeout to successful 530 ms cleanup. This is a cleanup
  regression result, not a throughput benchmark or a runsc internal fix.
- The protected local target is k3s v1.33.6 / containerd 2.1.5 / Calico v3.32.1,
  ARM64 OrbStack Linux, with SHA-512-verified runsc release-20260914.0.
  A probe reported `Starting gVisor`; judge CRI entries used `runsc`, and live
  prepared waves had runsc shim/gofer/sentry processes. This same-host target
  cannot prove production hardware performance or physical multi-node scaling.
- The follow-up K8s/gVisor suite passed 2 files / 15 tests in 229.68 seconds:
  13 existing standard/checker/interactive/advanced cases, plus C++ standard
  20-case and checker 5-case prepared attempts. Both prepared attempts compiled
  once, used fresh scratch and read-only artifacts across waves, and removed
  owned Jobs/Pods/ConfigMaps/PVCs. Afterward CRI sandbox inventory and runsc
  process inventory were empty; all 33 observed judge Pod UID cgroup paths were
  absent, with no remaining PVs or local-path directories. This is a bounded
  functional/runtime cleanup result; the full fault matrix remains open.
- Production performance, deployment, real multi-node failure behavior and
  exhaustive production-history replay are not verified.
- Timeout recovery now retains run/permit state until the exact old producer's
  stop acknowledgment. Initialization is single-attempt and cancellation-aware
  as well, preventing cleanup from racing a late temporary-object write.
- Registered FIFO survives attempt retries through a cleaned-run placeholder,
  atomic replacement and a stable submission ordering key. Work not yet
  registered with the coordinator is outside that ordering proof; registration
  latency at dispatch must be included in the full fairness acceptance.
- Database integration passed from a fresh marked PostgreSQL 18 database:
  86 files / 600 tests in 325.03 seconds, including the three-day queued/RUNNING
  stale-sweeper regression. Initial runs exposed missing local mailer settings
  and a schema left by an interrupted migration rehearsal; the successful run
  used CI's sink-mailer settings and a newly recreated task-owned database.
- Follow-up validation after the deletion fix passed build, typechecks, lint,
  formatting and 373 unit files / 3,337 tests. Two cleanup mocks were updated
  to read the DeleteOptions body. The control-worker lifecycle unit test now
  substitutes its Activity bundle, avoiding an unrelated slow dependency import
  and asserting the bundle is registered on the control queue.
- The follow-up `ci:verify` command reached component tests but did not exit
  successfully: the existing problem-description Markdown/math test exceeded
  its five-second timeout. It passed individually (4.43 seconds), and the full
  component suite passed 33 files / 61 tests with `--maxWorkers=2` in 25.19
  seconds. This supports local functional validation, not a claim that the
  default parallel CI invocation is consistently green. UI source is unchanged.
- Task-owned PostgreSQL/Redis containers and the k3d cluster were removed after
  verification; the default kubeconfig context remains `orbstack`. No production
  command or configuration change was performed during this follow-up.
- Release blockers: the current pause halts later waves, so selective dispatch
  drain / compatible history routing for rollback still needs implementation
  and verification. The ordinary migrator release window scales web to zero;
  a reviewed cutover that keeps accepting submissions is required. Refer to
  [the capacity runbook](../../runbooks/judge-capacity.md).
- The capacity flag remains disabled by default. No release, PR, version tag,
  Flux configuration change or 100-student production load test was performed.
- Detailed phases distinguish all judge modes. End-to-end observations retain
  the existing standard/advanced mode grouping and are emitted after completion
  persistence, including the cleanup-before-completion time.

Related: [Judge pipeline](../../architecture/JUDGE_PIPELINE.md),
[Reliability](../../operations/RELIABILITY.md),
[Deployment](../../operations/DEPLOYMENT.md), [Tests](../../runbooks/testing.md).
