# Judge snapshots pin testcase pointers instead of copying testcases

Status: approved by the owner on 2026-09-29. Changes JDG-10.

## Problem

Acceptance (`createSubmission` → `prepareJudgeSnapshot`) and rejudge read every
testcase of the problem into memory, embed the contents in one JSON snapshot and
upload it. Measured on 2026-09-29:

- Web RSS rises about 6.6× the problem's testcase bytes per concurrent
  submission: +224 MB locally for 34 MB, about +240 MB in production. This
  killed the web pod at 512Mi. At 1Gi (#588), a problem at the 50 MiB budget
  still allows only about two concurrent submissions. An exam burst on a large
  problem, or one batch rejudge, can still kill it.
- Every snapshot stores a full copy of the testcases: 947 executions hold
  3.3 GB, and 90 of them are over 10 MB. A batch rejudge of 200 submissions on a
  34 MB problem writes about 6.8 GB.
- The judge worker loads the whole snapshot on every stage and again at
  completion. Its peak was 1007 MiB.

Testcase objects are already immutable: every edit writes a new key
(`testcaseInputKey(problemId, testcaseId, randomUUID())`) that carries SHA-256
and size. The copy protects against one thing only: cleanup deleting an old
version while an execution still needs it.

## Design

### Snapshot format 2

`judgeSnapshotSchema` becomes a union on `format`:

- `format: 1`: unchanged. Existing snapshots stay readable and recoverable.
- `format: 2`: identical except that each testcase in
  `context.testcaseSets[].testcases[]` holds pointers instead of content:
  `{ id, weight, input: Pointer, output?: Pointer, inputFiles?: Record<string, Pointer> }`.
  Samples, workspace files, checker, interactor, validator scripts, sources and
  Advanced config stay inline. They are small and some are not immutable
  objects today.

Acceptance and rejudge build format 2 from the `Testcase` rows' existing
`inputStorage`, `outputStorage` and `inputFileStorage` pointers without reading
any testcase object. The `storageGeneration` before/after check stays, so a
concurrent edit still rejects the pin.

### Pinning table

A new table keeps pinned objects visible to cleanup:

```prisma
model JudgeExecutionObject {
  executionId String
  key         String
  sha256      String
  size        Int
  execution   JudgeExecution @relation(fields: [executionId], references: [id], onDelete: Cascade)
  @@id([executionId, key])
  @@index([key])
}
```

- `createJudgeExecution` inserts one row per pinned pointer in the same
  transaction that commits the execution.
- `storageObjectIsReferenced` adds
  `SELECT 1 FROM "JudgeExecutionObject" WHERE key = $1`, backed by the index.
- Problem deletion adds the pinned pointers to `removed`, so they are queued for
  cleanup like snapshots and stage results are today.
- Rows live as long as the execution. A replaced testcase version stays in
  storage while any execution that pinned it exists. Storage then grows per
  problem version instead of per submission.

Race: an edit that replaces a testcase after pinning but before the execution
commits is caught by the generation check. Old objects are only deleted after
`READER_GRACE_MS` (1 h) and a reference check, and the check sees the committed
row.

### Worker resolves pins when it loads an execution

`loadJudgeExecution` returns the same `SubmissionJudgeContext` as today: for a
format-2 snapshot it reads the pinned objects with `getVerifiedText` (hash and
size checked) and fills in the contents. Worker code, `buildSandboxRequest` and
`judgeStageRanges` do not change, so stage ranges stay a pure function of the
pinned content.

The worker no longer parses one large JSON string per stage, so its peak falls,
but it still holds the problem's testcases per stage. Reading only a stage's
slice was rejected for now: a stage holds up to 100 cases and 64 MiB, so almost
every problem is one stage and the saving would be small.

### Unchanged

- Rejudge still pins the latest version, and recovery still reuses the original
  pin (JDG-10).
- The sandbox payload, ConfigMap sharding and materializer (JDG-21) receive the
  same `SandboxRequest`.
- Format-1 snapshots are rewritten once by the compaction below; the reader
  keeps accepting format 1 so an execution that was skipped still recovers.

## Compacting existing format-1 snapshots

Many old testcase versions no longer exist as objects; the snapshot copy is the
only one left. Compaction therefore never depends on old objects:

1. Skip executions that are not terminal or hold a lease (`state` not in
   `completed`/`cancelled`, or `leaseToken` set); a later run picks them up.
2. Read the format-1 snapshot. For each testcase blob (input, output, input
   files), compute SHA-256. If the `Testcase` row's current pointer has the same
   hash and size, pin that pointer. Otherwise write the content to
   `problems/{problemId}/pinned-testcases/{sha256}` with `putObjectIfAbsent`
   and pin that. Identical content across the 90 large snapshots collapses into
   one object per distinct blob.
3. Write the format-2 snapshot under a new guarded key. In one transaction:
   check the execution's `snapshot` pointer is still the one read (otherwise
   skip), update it, insert the `JudgeExecutionObject` rows, and queue the old
   snapshot for cleanup through `commitStoragePointerSwap`.

It runs as `compact-judge-snapshots` in the worker image
(`--dry-run`, `--limit`), one execution at a time, and is idempotent: format-2
snapshots are skipped. Peak memory is one snapshot (about 250 MB for the
largest). Run it in the judge worker pod (2Gi limit) in a quiet window, only
after the release that ships it, and only with owner approval. Dry run reports
executions, bytes freed and objects to write.

A test compacts a format-1 execution whose original testcase objects were
deleted. Afterwards the execution judges identically, its old snapshot is
queued for cleanup, and a second run changes nothing.

## Alternatives rejected

- **One shared, content-addressed testcase bundle per problem generation.** The
  first submission after an edit still builds it in web memory, and concurrent
  first submissions race. Workers still load the whole bundle on every stage.
- **Building the snapshot in the worker after acceptance.** Pinning moves after
  the response, which breaks the acceptance-time version guarantee (PRB-15) and
  moves the spike to the worker.
- **Streaming the JSON serialization.** Saves about 24% of the spike and leaves
  the per-submission storage copy.

## Error handling

- A missing or corrupt pinned object is an infrastructure fault. The stage
  throws, the execution retries, and then blocks under the existing JDG-20
  rules. It never becomes a silent wrong verdict.
- Format-2 pins without `JudgeExecutionObject` rows cannot happen: both are
  written in one transaction. A test asserts that every pointer in a format-2
  snapshot has a row.

## Testing

- Unit: format-1 and format-2 parsing; the format-2 builder reads no testcase
  objects (storage mock asserts zero `GetObject` for testcase keys); stage
  ranges are equal for the same data in both formats.
- Unit: `storageObjectIsReferenced` is true for a key referenced only by
  `JudgeExecutionObject`; problem deletion queues pinned pointers.
- Integration (MinIO + Postgres): accept a submission, replace the testcases,
  run cleanup after the grace period; the pinned objects survive and the stage
  judges the old version.
- Memory regression: a test accepts a submission for a problem with 40 MB of
  testcases and asserts that the snapshot object stays under 1 MB and no
  testcase object is read. This is deterministic, unlike an RSS threshold.
- Worker: `loadJudgeExecution` on a format-2 snapshot returns the same context
  as the equivalent format-1 snapshot, and a corrupted pinned object throws
  `StorageIntegrityError`.

## Rollout

- One migration adds the table and index (expand only, safe with old pods).
- Two releases. Release N ships the migration and format-2 reading in the
  worker; web keeps writing format 1. Release N+1 switches acceptance and
  rejudge to format 2. Web and workers roll separately within one Helm upgrade,
  so a single release could let an old judge worker read a format-2 snapshot and
  mark it SE.
- After the release, verify: new executions have snapshot `size` in kilobytes;
  web `process_memory_usage_bytes` stays flat across a submission to the 34 MB
  problem; `JudgeExecutionObject` row count grows with executions.
- After release N+1, dry-run then run compaction (owner-approved); verify total
  snapshot bytes drop from about 3.3 GB and old snapshots are cleaned an hour
  later.
- Docs: JUDGE_PIPELINE acceptance section, JDG-10 revised (the old choice kept
  as `Rejected:`), DATABASE, and the Quality Ledger item removed.

## Owner decisions (2026-09-29)

- Retention: a pinned object stays as long as the execution row that pins it.
  SE recovery can happen at any time, so there is no time-based release.
- The existing format-1 copies are compacted in the same change (below).
