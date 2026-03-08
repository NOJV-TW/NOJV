# Production Delivery and GCP Deployment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the current NOJV POC into a production-shaped delivery candidate with asynchronous judge lifecycles, a dedicated sandbox execution service, and deployable GCP infrastructure assets.

**Architecture:** Keep `web` as the control plane and `worker` as the queue consumer, but stop blocking HTTP requests on BullMQ completion. Persist queued submission and workspace-run records up front, return operation IDs immediately, and let the worker update records asynchronously. Introduce a dedicated `sandbox` service for production execution so GCP deployment no longer depends on Docker-in-Docker. Keep local development on the Docker sandbox path and use the remote sandbox service for GCP deployment targets.

**Tech Stack:** Next.js, Vite, BullMQ, Prisma, PostgreSQL, Redis, Docker, Node.js HTTP service, Cloud Run, Cloud Build, Zod

---

### Task 1: Define asynchronous judge lifecycle contracts in tests

**Files:**

- Modify: `apps/web/tests/persistence-mappers.test.ts`
- Create: `apps/web/tests/judge-operations.test.ts`
- Create: `apps/worker/tests/async-processor-persistence.test.ts`

**Step 1: Write the failing tests**

- Add tests that prove:
  - `POST /api/submissions` returns `202` with a queued submission ID and poll URL
  - `POST /api/workspace/runs` returns `202` with a queued run ID and poll URL
  - `GET /api/submissions/:id` and `GET /api/workspace/runs/:id` expose queued and completed states
  - worker-side processors update existing queued records instead of relying on the web tier to wait

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @nojv/web test`  
Expected: FAIL because async operation routes and worker-side persistence do not exist yet.

**Step 3: Write minimal implementation**

- Introduce the smallest shared response shape needed for queued operation dispatch and polling.

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @nojv/web test && pnpm --filter @nojv/worker test`  
Expected: PASS.

### Task 2: Persist queued operations and move completion updates into the worker

**Files:**

- Modify: `apps/web/src/lib/server/poc-persistence.ts`
- Modify: `apps/web/src/app/api/submissions/route.ts`
- Modify: `apps/web/src/app/api/workspace/runs/route.ts`
- Create: `apps/web/src/app/api/submissions/[submissionId]/route.ts`
- Create: `apps/web/src/app/api/workspace/runs/[runId]/route.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/queue/src/index.ts`
- Modify: `apps/worker/src/processors.ts`
- Create: `packages/db/src/judge-operations.ts`
- Modify: `packages/db/src/index.ts`

**Step 1: Write the failing test**

- The red state is the new async lifecycle tests from Task 1.

**Step 2: Write minimal implementation**

- Add queue job schemas that wrap the payload plus the persisted operation ID.
- Create queued submission and workspace-run records before enqueueing.
- Add status fetch routes that read Prisma records by ID.
- Update the worker to:
  - mark records running
  - execute the job
  - persist final result back to the same record
  - emit cheating evidence for blocked workspace runs from the worker side

**Step 3: Run tests**

Run: `pnpm --filter @nojv/web test && pnpm --filter @nojv/worker test && pnpm --filter @nojv/web build`  
Expected: PASS.

### Task 3: Update the web and workspace UX to poll queued operations

**Files:**

- Modify: `apps/web/src/components/problem-editor.tsx`
- Modify: `apps/workspace/src/App.tsx`
- Create: `apps/web/src/lib/client/judge-operations.ts`

**Step 1: Write the failing test**

- Add focused tests for client-side operation polling helpers if needed.

**Step 2: Write minimal implementation**

- Switch submission and workspace UI flows from synchronous response handling to:
  - dispatch
  - poll
  - terminal-state render
- Preserve contest / exam blocking UX and anti-cheat messaging.

**Step 3: Run tests and builds**

Run: `pnpm --filter @nojv/web test && pnpm --filter @nojv/workspace build && pnpm --filter @nojv/web build`  
Expected: PASS.

### Task 4: Add a production sandbox service for GCP

**Files:**

- Create: `apps/sandbox/package.json`
- Create: `apps/sandbox/tsconfig.json`
- Create: `apps/sandbox/eslint.config.mjs`
- Create: `apps/sandbox/src/env.ts`
- Create: `apps/sandbox/src/index.ts`
- Create: `apps/sandbox/src/services/host-executor.ts`
- Create: `apps/sandbox/tests/host-executor.test.ts`
- Modify: `apps/worker/src/env.ts`
- Modify: `apps/worker/src/services/ephemeral-workspace.ts`
- Create: `apps/worker/src/services/remote-sandbox.ts`

**Step 1: Write the failing tests**

- Add tests that prove:
  - remote sandbox invocation uses authenticated HTTP calls
  - sandbox service validates payloads and returns normalized run results
  - worker can switch between local Docker sandbox and remote sandbox based on env

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @nojv/worker test && pnpm --filter @nojv/sandbox test`  
Expected: FAIL because the remote sandbox path does not exist yet.

**Step 3: Write minimal implementation**

- Build a small internal HTTP service that:
  - validates an internal bearer token
  - materializes files into a temp workspace
  - executes the command directly inside its own container
  - enforces timeout and command policy
- Add worker runtime selection:
  - `docker_local` for local development
  - `remote_http` for GCP deployment

**Step 4: Run tests**

Run: `pnpm --filter @nojv/worker test && pnpm --filter @nojv/sandbox test && pnpm --filter @nojv/sandbox build`  
Expected: PASS.

### Task 5: Replace placeholder GCP assets with deployable infrastructure definitions

**Files:**

- Modify: `infra/gcp/cloudbuild.yaml`
- Modify: `infra/gcp/README.md`
- Modify: `infra/gcp/web.cloudrun.yaml`
- Modify: `infra/gcp/worker.cloudrun.yaml`
- Modify: `infra/gcp/workspace.cloudrun.yaml`
- Create: `infra/gcp/sandbox.cloudrun.yaml`
- Create: `infra/gcp/deploy.sh`
- Modify: `README.md`
- Modify: `package.json`

**Step 1: Write minimal implementation**

- Build and push `web`, `workspace`, `worker`, and `sandbox` images.
- Add Cloud Run manifests and deployment script parameters for:
  - Artifact Registry repo
  - region
  - project ID
  - database / redis / sandbox secrets
  - internal sandbox URL and token
- Document the required GCP services and IAM roles.

**Step 2: Verify static deploy assets**

Run: `docker compose config && bash -n infra/gcp/deploy.sh`  
Expected: PASS.

### Task 6: End-to-end verification and deployment attempt

**Files:**

- No new files.

**Step 1: Run repository verification**

Run: `pnpm ci:verify`  
Expected: PASS.

**Step 2: Run local async smoke**

Run local dispatch + poll flows for:

- submission accepted path
- workspace run success path
- exam blocked-command path

Expected: all terminal states are reachable through poll routes.

**Step 3: Attempt GCP deployment**

Run:

```bash
infra/gcp/deploy.sh
```

Expected:

- If `gcloud`, project config, and auth exist: deploy succeeds and returns service URLs.
- If they do not exist: capture the exact blocker in the final report and leave deploy assets ready for the next run.
