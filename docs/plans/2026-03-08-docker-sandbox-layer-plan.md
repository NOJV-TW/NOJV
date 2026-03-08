# Docker Sandbox Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current temp-directory host execution path with a Docker-backed sandbox layer for workspace commands.

**Architecture:** Keep the existing worker boundary, but change the execution backend from direct host `spawn()` to `docker run` against a purpose-built sandbox image. The worker will still materialize the workspace into a temp directory, but actual command execution will happen inside a short-lived container with network disabled, CPU and memory limits, and a bounded process count.

**Tech Stack:** Node.js, BullMQ, Docker, TypeScript, Vitest

---

### Task 1: Define the sandbox contract in tests

**Files:**

- Modify: `apps/worker/tests/ephemeral-workspace.test.ts`
- Create: `apps/worker/tests/docker-sandbox.test.ts`

**Step 1: Write the failing test**

- Add tests that prove:
  - Docker invocation includes `--network none`, CPU and memory limits, and the workspace bind mount
  - exam / contest command policy still blocks forbidden commands before container launch
  - successful sandbox execution returns stdout/stderr/exit code in the existing normalized result shape

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @nojv/worker test`
Expected: FAIL because no Docker sandbox builder / runner exists yet.

**Step 3: Write minimal implementation**

- Introduce the smallest test seam needed to build Docker args and run the containerized command.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @nojv/worker test`
Expected: PASS.

### Task 2: Implement the Docker-backed executor

**Files:**

- Modify: `apps/worker/src/services/ephemeral-workspace.ts`
- Modify: `apps/worker/src/env.ts`
- Create: `apps/worker/src/services/docker-sandbox.ts`

**Step 1: Write the failing test**

- The red state is the worker tests from Task 1.

**Step 2: Write minimal implementation**

- Add worker env parsing for sandbox image and hard limits.
- Materialize files as before, then launch:
  - `docker run --rm`
  - `--network none`
  - CPU / memory / pids limits
  - `--cap-drop ALL`
  - `--security-opt no-new-privileges`
  - bind-mounted workspace
- Pipe stdin/stdout/stderr through the worker and preserve timeout handling.

**Step 3: Run tests**

Run: `pnpm --filter @nojv/worker test`
Expected: PASS.

### Task 3: Add sandbox image assets and local wiring

**Files:**

- Create: `infra/docker/sandbox-runner.Dockerfile`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docker-compose.yml`
- Modify: `infra/docker/worker.Dockerfile` only if local compose worker support is required

**Step 1: Write minimal implementation**

- Add a sandbox image with:
  - `make`
  - `gcc` / `g++`
  - `python3`
  - `node` / `npm`
  - `openjdk`
  - `rustc`
  - `bash`
- Document how to build the image locally and how the worker discovers it.

**Step 2: Verify**

Run: `docker compose config`
Expected: PASS.

### Task 4: Live verification

**Files:**

- No new files.

**Step 1: Run full repository verification**

Run: `pnpm ci:verify`
Expected: PASS.

**Step 2: Run live sandbox smoke**

Run:

```bash
docker build -f infra/docker/sandbox-runner.Dockerfile -t nojv-sandbox:local .
pnpm --filter @nojv/worker start
pnpm --filter @nojv/web start
```

Then verify:

- `POST /api/workspace/runs` with `make run` succeeds inside the containerized sandbox
- a forbidden `bash` exam / contest command is blocked before the container launch
- worker output still matches the existing API contract
