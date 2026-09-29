# Judge Snapshot Testcase Pointers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Judge snapshots pin testcase object pointers instead of embedding
testcase contents, so acceptance and rejudge read no testcase bytes and storage
holds one copy per problem version instead of one per submission.

**Architecture:** Snapshot `format: 2` stores `{ key, sha256, size }` pointers
for testcase input, output and input files. A `JudgeExecutionObject` table pins
those keys so storage cleanup keeps them. `loadJudgeExecution` resolves the pins
back into today's `SubmissionJudgeContext`, so the worker is unchanged. A
`compact-judge-snapshots` CLI rewrites existing format-1 snapshots. Spec:
`docs/superpowers/specs/2026-09-29-judge-snapshot-testcase-pointers.md`.

**Tech Stack:** TypeScript, Zod 4, Prisma 7 (PostgreSQL 18), AWS SDK S3 via
`@nojv/storage`, Vitest, esbuild (worker bundle).

**Release split:**

- **PR A (release N):** tasks 1–6. Readers accept format 2, pins are honoured,
  compaction ships. Web still writes format 1.
- **PR B (release N+1):** tasks 7–8. Acceptance and rejudge write format 2.
  Docs.
- Compaction runs in production only after release N is live, with owner
  approval.

Before pushing each PR, run the full checklist: `pnpm ci:verify`,
`pnpm typecheck:tests`, `pnpm test:component`, and the integration tests
touched.

---

### Task 1: `JudgeExecutionObject` table

**Files:**

- Modify: `packages/db/prisma/schema/submission.prisma` (model `JudgeExecution`
  at about line 301)
- Create: `packages/db/prisma/migrations/20260929000000_judge_execution_object/migration.sql`

**Step 1: Schema**

Add to `JudgeExecution`: `objects JudgeExecutionObject[]`. Add the model:

```prisma
model JudgeExecutionObject {
  executionId String
  key         String
  sha256      String
  size        Int

  execution JudgeExecution @relation(fields: [executionId], references: [id], onDelete: Cascade)

  @@id([executionId, key])
  @@index([key])
}
```

**Step 2: Migration**

```sql
CREATE TABLE "JudgeExecutionObject" (
    "executionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    CONSTRAINT "JudgeExecutionObject_pkey" PRIMARY KEY ("executionId", "key")
);
CREATE INDEX "JudgeExecutionObject_key_idx" ON "JudgeExecutionObject"("key");
ALTER TABLE "JudgeExecutionObject" ADD CONSTRAINT "JudgeExecutionObject_executionId_fkey"
    FOREIGN KEY ("executionId") REFERENCES "JudgeExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

A non-concurrent index is allowed here because the table is created in the same
migration (`scripts/migration-index-safety.mjs`).

**Step 3: Verify**

Run: `pnpm db:generate && node scripts/check-migrations.mjs && pnpm --filter @nojv/db build`.
Expected: no drift reported, build passes. Diff the Prisma-generated SQL
(`prisma migrate diff --from-migrations … --to-schema …`) against the file.

**Step 4: Commit** `feat(db): add JudgeExecutionObject for pinned judge objects`

---

### Task 2: Cleanup honours pins

**Files:**

- Modify: `packages/application/src/shared/storage-object-lifecycle.ts:176-196`
  (`storageObjectIsReferenced`)
- Modify: `packages/application/src/problem/mutations/records.ts:172-194`
  (problem deletion)
- Test: `tests/unit/application/storage-object-lifecycle.test.ts`, the
  problem-deletion unit test (find it with `rg "cannot be deleted" tests/unit`)

**Step 1: Failing tests**

- Assert that the reference query text contains `"JudgeExecutionObject"`. Follow
  the existing `$queryRaw` mock style in that file.
- Problem deletion: with a submission whose execution has
  `objects: [{ key: "k", sha256, size }]`, `commitStoragePointerSwap` receives
  that pointer in `removed`.

**Step 2:** Run
`pnpm vitest run tests/unit/application/storage-object-lifecycle.test.ts`.
Expected: FAIL.

**Step 3: Implement**

- Add `UNION ALL SELECT 1 FROM "JudgeExecutionObject" WHERE "key" = ${key}` to
  the `EXISTS`.
- Problem deletion: select
  `judgeExecutions: { select: { snapshot: true, stages: { select: { result: true } }, objects: { select: { key: true, sha256: true, size: true } } } }`
  and spread `...run.objects` into the pointer list.

**Step 4:** Tests pass.

**Step 5: Commit** `feat(application): storage cleanup keeps objects pinned by judge executions`

---

### Task 3: Snapshot format 2 schema and resolver

**Files:**

- Modify: `packages/application/src/submission/judge-snapshot.ts`
- Test: create `tests/unit/application/judge-snapshot.test.ts`

**Step 1: Failing tests**

1. `readJudgeSnapshot` parses a format-1 object unchanged.
2. `readJudgeSnapshot` on a format-2 object whose testcase has
   `input: pointer("in")`, `output: pointer("out")` and
   `inputFiles: { "a.txt": pointer("f") }` returns
   `context.testcaseSets[0].testcases[0]` equal to
   `{ id, weight, input: "IN", output: "OUT", inputFiles: { "a.txt": "F" } }`.
   Mock `@nojv/storage` `getVerifiedText` to map the snapshot key to the JSON
   and each testcase key to its text.
3. If `getVerifiedText` throws `StorageIntegrityError` for a pinned key,
   `readJudgeSnapshot` rejects with it.

**Step 2:** Run the file. Expected: FAIL.

**Step 3: Implement**

```ts
const pointerSchema = z.object({
  key: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().nonnegative(),
});
const pinnedTestcaseSchema = z.object({
  id: z.string(),
  weight: z.number(),
  input: pointerSchema,
  output: pointerSchema.optional(),
  inputFiles: z.record(z.string(), pointerSchema).optional(),
});
```

- Build `pinnedContextSchema` from `judgeContextSchema.extend(...)`, replacing
  `testcaseSets` with sets of `pinnedTestcaseSchema`.
- `judgeSnapshotSchema` becomes a `z.discriminatedUnion("format", [format1, format2])`.
  Export `JudgeSnapshot` as the resolved (format-1 shaped) type, so callers
  still see string contents.
- `readJudgeSnapshot`: parse. For format 2, resolve each set's testcases with
  `Promise.all` over `getVerifiedText(storage(), pointer)` and return
  `{ ...snapshot, format: 1, context: { ...context, testcaseSets: resolved } }`.
  Keeping `format: 1` on the resolved value keeps the downstream type single.
- Export `pinnedObjects(snapshot: PinnedSnapshot): StorageObjectPointer[]`,
  which flattens every input, output and input-file pointer, deduplicated by
  key.

**Step 4:** Tests pass. Run `pnpm --filter @nojv/application build`.

**Step 5: Commit** `feat(application): read format-2 judge snapshots with pinned testcases`

---

### Task 4: `createJudgeExecution` writes pins

**Files:**

- Modify: `packages/application/src/submission/judge-execution.ts:36-117`
- Test: `tests/unit/application/submission-complete-judge.test.ts`, or a new
  `judge-execution-pins.test.ts` using the same tx mock style

**Step 1: Failing test**

Calling `createJudgeExecution(tx, { …, pins: [p1, p2] })` calls
`tx.judgeExecutionObject.createMany` with
`{ data: [{ executionId, key, sha256, size }…], skipDuplicates: true }`. With
`pins` omitted, it makes no call.

**Step 2:** Run. Expected: FAIL.

**Step 3: Implement**

Add an optional `pins?: StorageObjectPointer[]` input. After
`tx.judgeExecution.create`, if it is non-empty, call `createMany`. Do not add
pins to `commitStoragePointerSwap(added)`: they are already-committed objects
with no write guard.

**Step 4:** Tests pass.

**Step 5: Commit** `feat(application): judge executions record pinned objects`

---

### Task 5: Compaction of format-1 snapshots

**Files:**

- Create: `packages/application/src/submission/judge-snapshot-compaction.ts`,
  exported from `packages/application/src/submission/index.ts`
- Create: `apps/worker/src/compact-judge-snapshots.ts`
- Modify: `apps/worker/build.mjs` (add an entry that emits
  `dist/compact-judge-snapshots.js`)
- Test: `tests/unit/application/judge-snapshot-compaction.test.ts`,
  `tests/integration/application/judge-snapshot-compaction.test.ts`

**Step 1: Failing unit tests** (mock db and storage)

1. A non-terminal execution (`state: "running"`) or one with a `leaseToken` →
   `{ outcome: "skipped_active" }`, and no writes.
2. A format-2 snapshot → `{ outcome: "already_compact" }`.
3. Format 1, with a testcase whose content hash equals the current `Testcase`
   row pointer's `sha256` → that pointer is pinned and nothing is uploaded.
4. Format 1, with no matching row pointer → `putObjectIfAbsent` is called with
   key `problems/{problemId}/pinned-testcases/{sha256}`. The pointer is pinned,
   and when `created`, it is guarded and passed to `added`.
5. In the transaction, the execution's `snapshot` key differs from the key that
   was read (a concurrent change) → `{ outcome: "skipped_changed" }`, and
   nothing is updated.
6. Success → the execution's `snapshot` is set to the new pointer, pins are
   inserted, and `commitStoragePointerSwap` receives
   `{ added: [newSnapshot, ...createdObjects], removed: [oldSnapshot] }`.
7. `dryRun: true` → returns `{ outcome: "would_compact", freedBytes, uploads }`
   and makes no writes.

**Step 2:** Run. Expected: FAIL.

**Step 3: Implement**

`compactJudgeSnapshot(executionId, { dryRun })` follows the spec's
"Compacting existing format-1 snapshots" section. `listCompactionCandidates(limit)`
selects executions whose `snapshot` is not referenced by any
`JudgeExecutionObject` row, in `createdAt` order. Also skip snapshots of 1 MiB
or less; small snapshots gain little. The worker CLI parses `--dry-run` and
`--limit N`, loops one execution at a time, logs one JSON line per execution
and prints totals. Wrap the entry in the same env and storage init as
`src/index.ts`, without starting Temporal.

**Step 4: Integration test** (Postgres + MinIO; see `docs/runbooks/testing.md`)

1. Seed a problem with two testcases and accept a submission, which writes
   format 1 today.
2. Replace the testcases so the old objects are queued for cleanup, and run
   cleanup with the grace time passed so the old objects are deleted.
3. Compact the execution; assert `outcome: "compacted"`.
4. `loadJudgeExecution` returns the old contents.
5. A second compaction returns `already_compact`.
6. Running cleanup for the new pinned objects leaves them in place.

**Step 5:** Run both test files, then `pnpm --filter @nojv/worker build`. Check
that `dist/compact-judge-snapshots.js` exists.

**Step 6: Commit** `feat(worker): compact format-1 judge snapshots into pinned objects`

---

### Task 6: PR A docs and ship

- `docs/runbooks/judge-queue.md`, or the closest runbook: how to run compaction
  in the judge worker pod (`kubectl exec deploy/nojv-worker -- node dist/compact-judge-snapshots.js --dry-run`),
  in a quiet window, with owner approval.
- `docs/architecture/DATABASE.md`: the new table (regenerate with
  `node scripts/generate-schema-docs.mjs` if that is how the doc is maintained).
- Open PR A, get CI green, merge, release, and verify that the worker reads
  format 1 unchanged: existing executions complete.

---

### Task 7: Acceptance and rejudge write format 2 (PR B)

**Files:**

- Modify: `packages/application/src/submission/judge-context.ts:67-90`
- Modify: `packages/application/src/submission/judge-snapshot.ts`
  (`prepareJudgeSnapshot`)
- Test: `tests/unit/application/judge-context.test.ts`, `judge-snapshot.test.ts`

**Step 1: Failing tests**

1. `getJudgePins(submissionId)` returns sets whose testcases carry the row
   pointers, and `readTestcaseBlobs` is never called. The existing mock in
   `judge-context.test.ts` asserts zero calls.
2. The memory regression test: for a problem with 40 testcases of
   `size: 1_048_576` each, `prepareJudgeSnapshot` uploads a snapshot body under
   1 MiB, never calls `getVerifiedText` for a testcase key, and returns
   `pins.length === 40` (plus outputs).
3. The `storageGeneration` before/after mismatch still throws `ConflictError`.

**Step 2:** Run. Expected: FAIL.

**Step 3: Implement**

- Split `getJudgeContext` so the testcase mapping produces pointers
  (`assertStorageObjectPointer` on `inputStorage`, `outputStorage`, and each
  `inputFileStorage` entry). Rename it `getPinnedJudgeContext`. Remove the
  now-unused `readTestcaseBlobs` import if nothing else uses it; `testcase.ts`
  still does.
- `prepareJudgeSnapshot` parses with the format-2 schema, writes `format: 2`,
  and returns `{ pointer, problemGeneration, pins: pinnedObjects(snapshot) }`.
  `creation.ts:449` and `rejudge-control.ts:313` already spread the result into
  `createJudgeExecution`, so the pins flow through. Verify the types compile.

**Step 4:** Tests pass. Run `tests/integration/submission-judge-flow.test.ts`
and `tests/integration/application/judge-execution-recovery.test.ts`.

**Step 5: Commit** `fix(application): judge snapshots pin testcase pointers instead of copying testcases`

---

### Task 8: PR B docs and ship

- `docs/architecture/JUDGE_PIPELINE.md` acceptance section: the snapshot holds
  testcase pointers pinned by `JudgeExecutionObject`, and the worker resolves
  them on load.
- `docs/decisions/judge.md` JDG-10: record the revision with `Source:` set to
  the PRs, and add `Rejected:` lines for embedding testcase contents (the
  memory and storage evidence), a shared per-generation bundle, and
  worker-built snapshots.
- `docs/operations/QUALITY_SCORE.md`: remove the snapshot follow-up.
- Delete this plan and the spec.
- Open PR B, get CI green, merge, and release. Verify in production (read-only):
  new executions' `snapshot->>'size'` is in kilobytes, and
  `process_memory_usage_bytes{exported_job="nojv-web"}` stays flat across a
  submission to the 34 MB problem (`cmu6wi6ls000601ildk2cwx6k`).
- Ask the owner, then run compaction: dry run first, then the real run. Verify
  that total snapshot bytes fall from about 3.3 GB after cleanup runs an hour
  later.
