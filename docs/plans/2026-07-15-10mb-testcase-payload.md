# 10 MiB Testcase Payload Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Accept testcase input and output files up to 10 MiB and execute them reliably in the network-isolated Kubernetes sandbox.

**Architecture:** Enforce the public limit by UTF-8 byte length in `@nojv/core`. Replace the single-ConfigMap sandbox payload with bounded binary ConfigMap shards, then reconstruct the files into an `emptyDir` in a hardened init container that verifies each file's size and SHA-256 before student code starts. Enforce process isolation at the kubelet's per-Pod cgroup instead of the host-UID-wide `RLIMIT_NPROC` used by the old image.

**Tech Stack:** TypeScript, Zod, Kubernetes Jobs/ConfigMaps, Node.js crypto/fs, Vitest, pnpm.

---

### Task 1: Testcase size contract

**Files:**

- Modify: `packages/core/src/schemas/problem.ts`
- Modify: `apps/web/src/lib/components/features/problem/testcase/TestcaseZipUploader.svelte`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/zh-TW.json`
- Test: `tests/unit/core/schemas.test.ts`

1. Add tests proving exactly 10 MiB of UTF-8 data is accepted and one byte more is rejected.
2. Export `MAX_TESTCASE_FILE_BYTES` and enforce it by encoded byte length for testcase input/output fields only.
3. Reject oversized ZIP entries in the browser before building the form payload and update both locale descriptions.
4. Run the focused schema and component tests.

### Task 2: Bounded Kubernetes payload shards

**Files:**

- Create: `apps/worker/src/services/k8s-payload.ts`
- Test: `tests/unit/worker/k8s-payload.test.ts`

1. Add failing tests for small payloads, multi-shard 10 MiB files, Unicode byte preservation, deterministic manifests, and invalid paths.
2. Build binary ConfigMap shards whose decoded data stays below the Kubernetes limit.
3. Include a manifest with each destination path, ordered chunk keys, byte size, and SHA-256.
4. Run the focused payload tests.

### Task 3: Verified sandbox materialization

**Files:**

- Create: `apps/sandbox-runner/src/payload-materializer.ts`
- Modify: `apps/sandbox-runner/src/index.ts`
- Test: `tests/unit/sandbox-runner/payload-materializer.test.ts`

1. Add failing tests for successful reconstruction and rejection of path traversal, missing chunks, size mismatch, and hash mismatch.
2. Implement the materializer with exclusive file creation and atomic failure cleanup.
3. Dispatch `SANDBOX_PHASE=materialize` before reading `config.json`.
4. Run the focused materializer tests and sandbox runner typecheck.

### Task 4: Job integration and cleanup

**Files:**

- Modify: `apps/worker/src/services/k8s-job-manifests.ts`
- Modify: `apps/worker/src/services/k8s-executor.ts`
- Test: `tests/unit/worker/k8s-job-manifests.test.ts`
- Test: `tests/unit/worker/k8s-executor.test.ts`

1. Add failing manifest tests for projected shard mounts, the materializer init container, a read-only submission mount, and no network or credentials.
2. Create all payload ConfigMaps before each Job and pass their names to the manifest builder.
3. Delete every shard on success, failure, and cancellation for standard, checker, and interactive paths.
4. Remove the image's host-UID-wide process limit and require `pod-max-pids=256` in k3s production and nightly integration clusters.
5. Run focused worker and sandbox tests.

### Task 5: Verification and production recovery

**Files:**

- Modify only if verification exposes a defect.

1. Run formatter, lint, typecheck, focused unit/integration tests, and sandbox/worker builds.
2. Render and inspect the Helm manifests; build the sandbox and worker images.
3. Commit and publish the isolated branch through the repository's normal delivery path.
4. Confirm production worker and sandbox image SHAs, rejudge submission `19131b89-f058-436a-b8b0-fd2b49e6bc29` once, and verify its terminal DB state, completed rejudge log, zero active queue entries, and no infrastructure error in logs.
