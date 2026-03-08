# Online Judge POC Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the current scaffold into a runnable POC with an in-browser editor, queue-backed workspace execution, contest-specific surfaces, and an end-to-end integrity signal flow.

**Architecture:** Keep the POC as one vertical slice per required area. The web app owns the editor and contest pages, the workspace app sends file-and-command payloads to Next.js APIs, and the worker executes those jobs inside per-run temporary directories while evaluating integrity signals through pure scoring logic.

**Tech Stack:** Next.js, Vite, BullMQ, Redis, Prisma, PostgreSQL, Zod, Vitest, Docker Compose

---

### Task 1: Define the execution contracts

**Files:**

- Modify: `packages/domain/src/index.ts`
- Modify: `packages/queue/src/index.ts`
- Test: `packages/queue/tests/contracts.test.ts`

**Step 1: Write the failing test**

- Extend queue tests to require file payloads and integrity event metadata.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @nojv/queue test`
Expected: FAIL because the new payload shape is not implemented yet.

**Step 3: Write minimal implementation**

- Add workspace file schemas.
- Add integrity telemetry event schema.
- Update queue job helpers to accept the new payloads.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @nojv/queue test`
Expected: PASS.

### Task 2: Build the core worker behavior with TDD

**Files:**

- Create: `apps/worker/src/services/ephemeral-workspace.ts`
- Create: `apps/worker/src/services/integrity-score.ts`
- Create: `apps/worker/tests/ephemeral-workspace.test.ts`
- Create: `apps/worker/tests/integrity-score.test.ts`
- Modify: `apps/worker/src/processors.ts`

**Step 1: Write the failing tests**

- Prove the worker can write files into a temp directory and run a command there.
- Prove integrity scoring escalates suspicious telemetry combinations.

**Step 2: Run tests to verify red**

Run: `pnpm --filter @nojv/worker test`
Expected: FAIL because the services do not exist yet.

**Step 3: Write minimal implementation**

- Materialize job files into a per-run directory.
- Execute shell commands with timeout and capture stdout/stderr.
- Add a deterministic integrity scoring function.

**Step 4: Run tests to verify green**

Run: `pnpm --filter @nojv/worker test`
Expected: PASS.

### Task 3: Add the API slice in Next.js

**Files:**

- Create: `apps/web/src/app/api/workspace/runs/route.ts`
- Create: `apps/web/src/app/api/submissions/route.ts`
- Create: `apps/web/src/app/api/integrity/signals/route.ts`
- Create: `apps/web/src/lib/server/queue.ts`

**Step 1: Write the failing test**

- Validation is build and typecheck because route handlers are integration glue.

**Step 2: Verify red**

Run: `pnpm --filter @nojv/web build`
Expected: FAIL until the new route handlers and imports are correct.

**Step 3: Write minimal implementation**

- Accept workspace run requests and wait for BullMQ job completion.
- Accept submission requests and return a POC verdict payload.
- Accept integrity signals and return a risk summary.

**Step 4: Verify green**

Run: `pnpm --filter @nojv/web build`
Expected: PASS.

### Task 4: Upgrade the UI into a runnable POC

**Files:**

- Create: `apps/web/src/components/problem-editor.tsx`
- Create: `apps/web/src/components/telemetry-probe.tsx`
- Modify: `apps/web/src/app/[locale]/problems/page.tsx`
- Create: `apps/web/src/app/[locale]/problems/[slug]/page.tsx`
- Modify: `apps/web/src/app/[locale]/contests/page.tsx`
- Create: `apps/web/src/app/[locale]/contests/[slug]/page.tsx`
- Modify: `apps/workspace/src/App.tsx`

**Step 1: Write the failing test**

- Validation is application build.

**Step 2: Verify red**

Run: `pnpm --filter @nojv/web build && pnpm --filter @nojv/workspace build`
Expected: FAIL until the new pages and components compile.

**Step 3: Write minimal implementation**

- Add a problem detail page with Monaco editor and submission action.
- Add contest detail page as a distinct contest zone.
- Add telemetry capture on editor interactions.
- Wire the Vite workspace client to the Next.js API.

**Step 4: Verify green**

Run: `pnpm --filter @nojv/web build && pnpm --filter @nojv/workspace build`
Expected: PASS.

### Task 5: Full verification

**Files:**

- No new files.

**Step 1: Run the full suite**

Run:

```bash
pnpm format
pnpm lint
pnpm test
pnpm build
pnpm db:validate
docker compose config
```

Expected: all commands exit successfully.

**Step 2: Manual checklist**

- Problem detail page offers in-browser editing.
- Workspace can send files plus commands through the queue-backed API.
- Contest detail page is separate from normal practice flow.
- Integrity telemetry reaches a risk-evaluation path.
