# Safe Judge Latency Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce warm-node Kubernetes judge latency without weakening gVisor, per-case isolation, NetworkPolicy, retry, or verdict semantics.

**Architecture:** Replace the shared Kubernetes Job completion polling loop with resource-versioned Job/Pod watches and reconnect/resync handling. Merge only the standard/checker run Job's materialize and compile init containers into one hardened `prepare` init container; testcase containers remain independent and unchanged.

**Tech Stack:** TypeScript, `@kubernetes/client-node` Watch, Kubernetes Jobs/Pods, Helm, Vitest, k3d integration tests.

---

## Scope and acceptance

- Target fixture: problem `cmsh7cvae000c01oecxkaa042`, 20 standard cases, fixed fast C++ source, warm cached sandbox image, sequential submissions.
- Baseline and post-change staging benchmark: one warm-up plus 30 runs; production canary: 10 sequential runs.
- Goal: warm-node median <=10s and p95 <=12s. Minimum ship gate: median improves >=10%, p95 does not regress, verdict/security/reliability invariants remain unchanged.
- No hardware, autoscaling, case sharding, warm runner, worker concurrency, Temporal workflow, DB, public API, queue, or new dependency changes.

## Tasks

### Task 1: Establish isolated baseline and plan artifact

**Files:**

- Create: `docs/plans/active/2026-08-07-safe-judge-latency-phase-1.md`

**Steps:**

1. Work only in a fresh worktree from `origin/main`; preserve unrelated root-worktree changes.
2. Install dependencies with `pnpm install --frozen-lockfile`.
3. Run the existing targeted worker/sandbox unit suites and record any pre-existing failures.
4. In staging, run the fixed 20-case fixture after one discarded warm-up. Record end-to-end, `scheduleAndExecutionMs`, logs, cleanup, total, image digest, worker version, node, and timestamps for 30 sequential runs.

### Task 2: Implement resource-versioned Kubernetes Job/Pod Watch

**Files:**

- Modify: `apps/worker/src/services/k8s-executor.ts`
- Modify: `infra/charts/nojv/templates/worker-rbac.yaml`
- Test: `tests/unit/worker/k8s-job-watch.test.ts`

**Steps:**

1. Add the smallest injectable Watch interface needed by tests; production constructs `Watch` from the existing in-cluster `KubeConfig` and uses the already-installed dependency.
2. Extend only the sandbox-manager Role's Job verbs with `list` and `watch`; do not add update, patch, Secret, or cross-namespace access.
3. Refactor the shared `waitForJobOutcome()` used by standard, checker, interactive, and advanced paths:
   - read the exact Job and list matching Pods first, evaluate terminal state immediately, and capture collection resource versions;
   - watch Jobs with `fieldSelector=metadata.name=<jobName>` and Pods with `labelSelector=job-name=<jobName>`;
   - evaluate every event using existing success, deadline, backpressure, image-pull, and infrastructure classification;
   - preserve Pod-Succeeded-before-Job-controller completion;
   - on normal close, timeout, or HTTP 410, resync and reopen from the new resource version with bounded exponential reconnect backoff;
   - on failed resync or non-recoverable watch error, throw the existing retryable infrastructure error;
   - close both watch controllers and timers on success, failure, deadline, or abort;
   - retain the existing 30-second schedule grace and overall Job deadline, but remove fixed one-second polling.
4. Add unit coverage for immediate snapshot completion, Job/Pod success events, missed-event race, reconnect/410, abort cleanup, quota/unschedulable, image pull, eviction/node loss, and deadline behavior.
5. Render RBAC and assert the permission delta is limited to Job list/watch.

### Task 3: Merge materialize and compile into `prepare`

**Files:**

- Modify: `apps/sandbox-runner/src/index.ts`
- Modify: `apps/worker/src/services/k8s-job-manifests.ts`
- Modify: `apps/worker/src/services/k8s-executor.ts`
- Test: `tests/unit/worker/k8s-payload-orchestration.test.ts`
- Test: `tests/unit/worker/k8s-checker.test.ts`

**Steps:**

1. Add `SANDBOX_PHASE=prepare` that runs the existing payload materializer, reads the validated config, and runs the existing compile phase; keep standalone `materialize` for other manifests.
2. Replace the per-case Job's `materialize` plus `compile` init containers with one container named `prepare`; mount payload read-only, submission writable only for prepare, artifact writable only for prepare, and preparation-specific scratch subpaths.
3. Keep all preparation resources and hardened security fields equal to the current compile container.
4. Keep case container count, CPU/memory limits, read-only artifact, independent scratch subPaths, no-answer run payload, and one compile per wave unchanged.
5. Update worker log lookup and timing names: rename `materializeMs` to `payloadConfigMapsMs`, add `jobCreateMs`, and retain schedule/execution, prepare logs, case logs, cleanup, and total timings.
6. Add manifest, payload secrecy, 20/21-case wave, compile-error, interpreted-language, multi-file, and materializer-integrity tests.

### Task 4: Integration, security, and benchmark validation

**Files:**

- Modify: `docs/architecture/JUDGE_PIPELINE.md`
- Modify: `docs/operations/RELIABILITY.md` only for the actual timing/Watch behavior; do not change the formal SLO before production evidence.

**Steps:**

1. Run targeted unit tests, then the protected k3d Kubernetes integration suite with `REQUIRE_K8S=1` and an owned test namespace.
2. Verify standard AC/WA/CE, checker, cancellation, Watch reconnect, Temporal retry, cleanup, no duplicate active Job, and no lost submission behavior.
3. Run the existing sandbox security coverage for gVisor, deny-all egress, metadata/service-account access, fork/memory bombs, timeout, filesystem escape, and cross-case scratch isolation.
4. Render Helm manifests and run `pnpm ci:verify`.
5. Deploy to staging, run the fixed warm benchmark, compare p50/p95 and phase timings, then run the 10-run production canary only after staging passes.
6. Observe 24 hours of latency, SE rate, Watch reconnects, Pending Pods, Temporal retries, and cleanup. Roll back the worker image if verdicts differ, SE rises, Watch cannot recover, or p95 exceeds the existing 15-second SLO.
7. After release acceptance, move this plan to `docs/plans/completed/`.

## Required commands

```bash
pnpm install --frozen-lockfile
pnpm exec vitest run --project unit \
  tests/unit/worker/k8s-job-watch.test.ts \
  tests/unit/worker/k8s-payload-orchestration.test.ts \
  tests/unit/worker/k8s-checker.test.ts \
  tests/unit/sandbox-runner/payload-materializer.test.ts

REQUIRE_K8S=1 \
K8S_TEST_RUN_ID=<dns-safe-run-id> \
K8S_TEST_NAMESPACE=nojv-sandbox-test-<dns-safe-run-id> \
pnpm test:integration:k8s

pnpm ci:verify
```

## Security and reliability invariants

- Production sandbox Pods continue to require gVisor, NetworkPolicy, non-root, read-only rootfs, dropped capabilities, no privilege escalation, seccomp, no service-account token, resource limits, and active deadlines.
- Every testcase remains a separate container/cgroup/scratch path; no reusable runner and no shard process is introduced.
- Temporal retry, fresh ephemeral run IDs, fixed submission workflow IDs, transactional outbox, and existing infrastructure-error classification remain unchanged.
- No answer/checker data is added to standard/checker run payloads.
