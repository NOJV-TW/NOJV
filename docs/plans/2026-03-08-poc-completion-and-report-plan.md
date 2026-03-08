# POC Completion And Architecture Report Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the remaining POC gaps so every requested feature area and required tech stack has at least one real execution path, then produce an architecture and scalability report.

**Architecture:** Keep the current vertical-slice POC, but add Prisma-backed persistence and reviewer records on the write path instead of rebuilding the platform shape. Use pure helper tests where possible, then verify the full end-to-end runtime with Redis, PostgreSQL, web, and worker processes.

**Tech Stack:** Next.js, Vite, Prisma, PostgreSQL, Redis, BullMQ, Zod, Vitest, Docker Compose

---

### Task 1: Define POC completion boundaries

**Files:**

- Create: `docs/reports/2026-03-08-poc-architecture-report.md`
- Modify: `README.md`

**Step 1: Write the report skeleton**

- Add sections for feature coverage, architecture, risk review, scalability, and Kubernetes analysis.

**Step 2: Verify red**

Run: `test -f docs/reports/2026-03-08-poc-architecture-report.md`
Expected: FAIL before the file exists.

**Step 3: Write minimal implementation**

- Create the report shell and update README instructions to include DB push / persistence expectations.

**Step 4: Verify green**

Run: `test -f docs/reports/2026-03-08-poc-architecture-report.md`
Expected: PASS.

### Task 2: Add tested persistence mapping helpers

**Files:**

- Create: `apps/web/src/lib/server/persistence-mappers.ts`
- Create: `apps/web/tests/persistence-mappers.test.ts`

**Step 1: Write the failing test**

- Prove workspace and submission results map cleanly into Prisma status enums and case summaries.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @nojv/web test`
Expected: FAIL because the helper does not exist yet.

**Step 3: Write minimal implementation**

- Add pure mapping helpers for submission status, workspace status, and cheating case summary text.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @nojv/web test`
Expected: PASS.

### Task 3: Persist the POC write path with Prisma

**Files:**

- Create: `apps/web/src/lib/server/poc-persistence.ts`
- Modify: `apps/web/src/app/api/submissions/route.ts`
- Modify: `apps/web/src/app/api/workspace/runs/route.ts`
- Modify: `apps/web/src/app/api/integrity/signals/route.ts`
- Modify: `package.json`
- Modify: `README.md`

**Step 1: Write the failing test**

- The red check is runtime smoke validation after `prisma db push`.

**Step 2: Verify red**

Run: `pnpm --filter @nojv/web build`
Expected: build passes, but runtime persistence is not present yet.

**Step 3: Write minimal implementation**

- Add helper functions that upsert demo users, problems, contests, sessions, submissions, workspace runs, cheating signals, and cheating cases.
- Persist after queue-backed execution completes.
- Add `db:push` for the local POC bootstrap path.

**Step 4: Verify green**

Run: runtime smoke tests against `POST /api/submissions`, `POST /api/workspace/runs`, and `POST /api/integrity/signals`, followed by direct DB inspection.
Expected: records exist in PostgreSQL and remain linked by the Prisma relations.

### Task 4: Final architecture and scalability analysis

**Files:**

- Modify: `docs/reports/2026-03-08-poc-architecture-report.md`

**Step 1: Write the analysis**

- Evaluate requested feature coverage.
- Review potential code and runtime failure modes.
- Analyze horizontal scaling limits, queue pressure points, DB bottlenecks, and Kubernetes fit.

**Step 2: Verify**

Run: `pnpm format && pnpm lint`
Expected: PASS.

### Task 5: Full verification

**Files:**

- No new files.

**Step 1: Run the full suite**

Run:

```bash
pnpm ci:verify
```

Expected: PASS.

**Step 2: Run runtime smoke verification**

Run:

```bash
docker compose up -d postgres redis
pnpm db:push
pnpm --filter @nojv/worker start
pnpm --filter @nojv/web start
```

Then verify:

- submission API returns a verdict and persists a submission row
- workspace API returns execution output and persists a workspace run row
- integrity API returns a risk score and persists signals plus case data
