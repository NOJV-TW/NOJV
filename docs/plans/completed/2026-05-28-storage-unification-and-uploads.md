# Storage Unification + Multi-file Uploads — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to dispatch one fresh subagent per task, with code review between tasks.

**Goal:** Move all blob-class submission data (sourceCode, verdictDetail heavy part) from DB to S3; fix two known auditing leaks (editorial context gate, MOSS multi-file); add uploader paths and zip import/export for problem authors.

**Architecture:**

- Single source of truth for file-class data: `@nojv/storage` (S3-compatible). DB only holds metadata + storage keys.
- `Submission.sourceCode` (DB text) → multiple S3 objects under `submissions/{id}/sources/{path}`. Multi-file is no longer a JSON-string special case.
- `Submission.verdictDetail` (DB JSON) → split: `verdictSummary` (DB JSON, < 4KB) for list views; full detail in S3 at `submissions/{id}/verdict-detail.json` for lazy load.
- New problem-author upload routes accept single files (drag-drop or Monaco), and a zip bundle (testcases + workspace + checker/interactor only).
- Pre-production: NO existing data to migrate. Drop the columns, rewrite `db:seed`.

**Tech Stack:** TypeScript / SvelteKit / Prisma 7 / S3 SDK v3 / Vitest / Playwright / `archiver` + `unzipper` for zip bundles.

**Wave Structure (file-disjoint within each wave so subagents can run in parallel):**

```
W0 (sequential)  : storage helpers + schema migration
W1 (sequential)  : submission write + read paths
W2 (parallel x3) : editorial gate | MOSS S3-aware | db:seed rewrite
W3 (parallel x5) : workspace upload | checker upload | interactor upload | zip import | zip export
W4 (parallel x2) : UI integration  | docs sync
W5 (sequential)  : ci:verify + final review
```

---

## Wave 0 — Foundation (sequential)

### Task W0.1: Storage keys + sources / verdict-detail helpers

**Files:**

- Modify: `packages/storage/src/keys.ts`
- Modify: `packages/storage/src/index.ts` (re-exports)
- Create: `packages/storage/src/submission.ts` — put/get for sources + verdict-detail
- Create: `tests/unit/storage/submission-storage.test.ts`

**Step 1: Write failing test**

```ts
// tests/unit/storage/submission-storage.test.ts
import { describe, it, expect } from "vitest";
import {
  submissionSourcePrefix,
  submissionSourceKey,
  submissionVerdictDetailKey,
} from "@nojv/storage";

describe("submission storage keys", () => {
  it("scopes sources under submission id", () => {
    expect(submissionSourcePrefix("sub_abc")).toBe("submissions/sub_abc/sources/");
    expect(submissionSourceKey("sub_abc", "main.cpp")).toBe(
      "submissions/sub_abc/sources/main.cpp",
    );
  });

  it("rejects paths escaping the prefix", () => {
    expect(() => submissionSourceKey("sub_abc", "../etc/passwd")).toThrow();
    expect(() => submissionSourceKey("sub_abc", "/abs")).toThrow();
  });

  it("verdict detail key is per submission", () => {
    expect(submissionVerdictDetailKey("sub_abc")).toBe(
      "submissions/sub_abc/verdict-detail.json",
    );
  });
});
```

Run: `pnpm vitest run tests/unit/storage/submission-storage.test.ts` → FAIL (functions undefined).

**Step 2: Implement key builders + helpers**

In `packages/storage/src/keys.ts` add:

```ts
export function submissionSourcePrefix(submissionId: string): string {
  return `submissions/${submissionId}/sources/`;
}

export function submissionSourceKey(submissionId: string, path: string): string {
  if (path.includes("..") || path.startsWith("/") || path.includes("\\") || path === "") {
    throw new Error(`Invalid submission source path: ${path}`);
  }
  return `${submissionSourcePrefix(submissionId)}${path}`;
}

export function submissionVerdictDetailKey(submissionId: string): string {
  return `submissions/${submissionId}/verdict-detail.json`;
}
```

In `packages/storage/src/submission.ts`:

```ts
import type { StorageClient } from "./client";
import { getText, putText, listByPrefix, deleteBlobsByPrefix } from "./blob";
import {
  submissionSourcePrefix,
  submissionSourceKey,
  submissionVerdictDetailKey,
} from "./keys";

export interface SubmissionSource {
  path: string;
  content: string;
}

export async function putSubmissionSources(
  storage: StorageClient,
  submissionId: string,
  sources: SubmissionSource[],
): Promise<void> {
  await Promise.all(
    sources.map((s) => putText(storage, submissionSourceKey(submissionId, s.path), s.content)),
  );
}

export async function getSubmissionSources(
  storage: StorageClient,
  submissionId: string,
): Promise<SubmissionSource[]> {
  const prefix = submissionSourcePrefix(submissionId);
  const keys = await listByPrefix(storage, prefix);
  const sources = await Promise.all(
    keys.map(async (key) => ({
      path: key.slice(prefix.length),
      content: await getText(storage, key),
    })),
  );
  sources.sort((a, b) => a.path.localeCompare(b.path));
  return sources;
}

export async function putVerdictDetail(
  storage: StorageClient,
  submissionId: string,
  detail: unknown,
): Promise<void> {
  await putText(storage, submissionVerdictDetailKey(submissionId), JSON.stringify(detail));
}

export async function getVerdictDetail<T>(
  storage: StorageClient,
  submissionId: string,
): Promise<T | null> {
  try {
    const raw = await getText(storage, submissionVerdictDetailKey(submissionId));
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as { name?: string }).name === "NoSuchKey") return null;
    throw err;
  }
}

export async function deleteSubmissionStorage(
  storage: StorageClient,
  submissionId: string,
): Promise<void> {
  await deleteBlobsByPrefix(storage, `submissions/${submissionId}/`);
}
```

Add `listByPrefix` to `packages/storage/src/blob.ts` if not present (uses S3 ListObjectsV2).

Update `packages/storage/src/index.ts` to re-export the new symbols.

**Step 3: Run test → PASS.**
Run: `pnpm vitest run tests/unit/storage/submission-storage.test.ts`

**Step 4: typecheck + lint**
Run: `pnpm typecheck && pnpm lint`

**Step 5: Commit**

```bash
git add packages/storage tests/unit/storage
git commit -m "feat(storage): submission source + verdict-detail helpers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task W0.2: Submission schema migration

**Files:**

- Modify: `packages/db/prisma/schema/submission.prisma`
- Create: `packages/db/prisma/migrations/20260528000000_submission_storage_unification/migration.sql`
- Modify: `packages/db/src/repositories/submission.ts` — replace `sourceCode`/`verdictDetail` usages

**Step 1: Schema change**

In `packages/db/prisma/schema/submission.prisma`:

- Remove `sourceCode String @db.Text`
- Remove `verdictDetail Json?` (if present; locate via grep)
- Add `sourceStoragePrefix String` (defaults to `""` on legacy rows, but pre-prod we just enforce non-null)
- Add `verdictSummary Json?` — used by list views; shape = `{ caseSummary: { ac, wa, tle, mle, re, other }, subtaskSummary?: { id, score }[], compilerErrorTruncated?: string }`
- Add `verdictDetailStorageKey String?` — null until judge writes detail

**Step 2: Migration SQL**

```sql
-- migration.sql
ALTER TABLE "Submission" DROP COLUMN "sourceCode";
ALTER TABLE "Submission" DROP COLUMN "verdictDetail";
ALTER TABLE "Submission" ADD COLUMN "sourceStoragePrefix" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Submission" ADD COLUMN "verdictSummary" JSONB;
ALTER TABLE "Submission" ADD COLUMN "verdictDetailStorageKey" TEXT;
ALTER TABLE "Submission" ALTER COLUMN "sourceStoragePrefix" DROP DEFAULT;
```

**Step 3: Regenerate Prisma client**

Run: `pnpm db:generate`. This will surface every consumer of the removed columns as TS errors — that's intentional, they get fixed in later waves.

**Step 4: Repository surface update**

In `packages/db/src/repositories/submission.ts`:

- `findForPlagiarism`: drop `sourceCode` from `select`; add `sourceStoragePrefix`
- `findById` / `findMany` variants: remove `sourceCode`; the domain layer will compose with S3 reads
- Any `create` / `update` signatures referencing `sourceCode` / `verdictDetail`: rename to `sourceStoragePrefix` / `verdictSummary` + `verdictDetailStorageKey`

**Step 5: typecheck shows expected breakage**

Run: `pnpm typecheck`. Expected: many failures in `packages/domain/src/submission/`, `apps/worker/src/activities/judge.ts`, `apps/web/src/routes/api/submissions/...`. These are the W1 tasks' targets.

**Step 6: Push the migration to dev DB**

Run: `pnpm db:push` (since we're pre-prod, push not migrate).

**Step 7: Commit**

```bash
git add packages/db
git commit -m "feat(db): submission storage unification schema

BREAKING: drops sourceCode + verdictDetail columns. Consumers updated
in follow-up commits within the same PR.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

> **W0 gate before W1:** typecheck is expected to still fail at this point — that's fine; the failures are the W1 worklist. lint should be clean. `pnpm test:unit` will also have failures in submission-touching files; the W1 work will restore green.

---

## Wave 1 — Submission write + read paths (sequential)

### Task W1.1: Submission write path (mutations.ts) → S3

**Files:**

- Modify: `packages/domain/src/submission/mutations.ts` (the `createQueuedSubmissionRecord` tx body, ~lines 175–247)
- Modify: `tests/unit/domain/submission-mutations*.test.ts` — update existing tests; they were asserting `sourceCode`

**Step 1: Update test expectations**

For each test that called `createQueuedSubmissionRecord(...)` and asserted `submission.sourceCode === "..."`, change to assert:

- `submission.sourceStoragePrefix === "submissions/<id>/sources/"`
- `await getSubmissionSources(storage, submission.id)` returns the expected file list

Use the `storage` fixture from `tests/unit/_fixtures/storage.ts` (create it if missing — in-memory `StorageClient` mock with `putText` / `getText` / `listByPrefix`).

**Step 2: Implement**

```ts
// inside createQueuedSubmissionRecord, right after validation, BEFORE submissionRepo.create
const sources = normalizeSubmissionSources(payload, problem);
//   normalizeSubmissionSources returns SubmissionSource[]:
//   - single-file: [{ path: `main.${ext}`, content: payload.sourceCode }]
//   - multi-file: payload.sourceFiles (already path-bearing)
//   - validation: every path passes submissionSourceKey() check; total bytes ≤ 1 MB hard cap

const submission = await submissionRepo.withTx(tx).create({
  // ...all existing fields except sourceCode...
  sourceStoragePrefix: submissionSourcePrefix(generatedId),
});

// Storage write is OUTSIDE the tx — tx may roll back; we accept orphan blobs
// over blocking writes inside a serializable tx. Cleanup job sweeps orphans.
// Use a deterministic id generated up-front so prefix + create id match.
```

Hoist the cuid generation: `const submissionId = createId();` before the tx, pass it explicitly to `submissionRepo.create({ id: submissionId, ... })`.

Storage write happens AFTER `tx` commits — pass it back to caller via a returned thunk or do it inline post-tx. Inline post-tx is simpler:

```ts
return await runTransaction(async (tx) => { ...create row... });
// then:
await putSubmissionSources(storage, submissionId, sources);
return submission;
```

If put fails, mark submission `system_error` immediately so it doesn't sit queued.

**Step 3: Run unit tests**

Run: `pnpm vitest run tests/unit/domain/submission-mutations`

Expected: all green (existing assertions migrated to S3 + new assertions added).

**Step 4: typecheck + lint**

**Step 5: Commit**

```bash
git add packages/domain/src/submission tests/unit/domain
git commit -m "feat(submission): write sources to S3 on create

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task W1.2: Submission read helpers + judge worker

**Files:**

- Modify: `packages/domain/src/submission/queries.ts` — add `getSubmissionSources(id)`, `getVerdictDetail(id)`; the existing `getJudgeContext` calls the new helper
- Modify: `apps/worker/src/activities/judge.ts` — replace `draft.sourceCode` reads with the helper
- Modify: `apps/web/src/routes/api/submissions/[id]/source/+server.ts` — return `{ files: [{path, content}] }` instead of legacy single-string
- Modify: `apps/web/src/routes/api/plagiarism/[assignmentId]/sources/[userId]/[problemId]/+server.ts` — same shape
- Modify: any UI component reading source via these endpoints (`apps/web/src/lib/components/submission/SourceViewer.svelte` if present — grep first)
- Update tests in `tests/unit/domain/submission-queries*.test.ts` and any judge worker test using `draft.sourceCode`

**Step 1: Write tests for new helpers (TDD)**

```ts
// tests/unit/domain/submission-queries.test.ts (add)
it("getSubmissionSources returns files written by mutation", async () => {
  const submission = await createQueuedSubmissionRecord(/* ... payload with sourceFiles */);
  const sources = await getSubmissionSources(submission.id);
  expect(sources).toEqual([
    { path: "main.cpp", content: "..." },
    { path: "util.cpp", content: "..." },
  ]);
});

it("getVerdictDetail returns null if not yet judged", async () => {
  const submission = await createQueuedSubmissionRecord(/* ... */);
  expect(await getVerdictDetail(submission.id)).toBeNull();
});
```

**Step 2: Implement**

```ts
// packages/domain/src/submission/queries.ts
import { storage } from "../shared/storage-singleton"; // create if missing
import {
  getSubmissionSources as storageGetSources,
  getVerdictDetail as storageGetDetail,
} from "@nojv/storage";

export async function getSubmissionSources(submissionId: string) {
  return storageGetSources(storage(), submissionId);
}

export async function getVerdictDetail<T = unknown>(submissionId: string): Promise<T | null> {
  return storageGetDetail<T>(storage(), submissionId);
}
```

In `apps/worker/src/activities/judge.ts`:

- Replace `mergeSandboxSources(draft, judgeContext)` — the function still receives a `draft` shape, but the activity's caller now loads sources via `getSubmissionSources(submissionId)` and passes them as `draft.sourceFiles`. `draft.sourceCode` retained only for the legacy single-file collapse but populated from `sources.find(s => s.path === mainPath)?.content`.

In source / plagiarism source endpoints: return `{ files: SubmissionSource[] }`. Update the staff-facing UI consumer to render a tabbed file list if multi-file (sniff `files.length > 1`).

**Step 3: Run all touched tests**

Run: `pnpm vitest run tests/unit/domain tests/unit/web/submission-source`
Run: `pnpm test:integration tests/integration/judge` (uses MinIO)

**Step 4: typecheck + lint clean**

**Step 5: Commit**

```bash
git add packages apps tests
git commit -m "feat(submission): read sources/verdict via storage helpers

Worker, source API, and staff plagiarism source endpoint all now go
through @nojv/storage. Multi-file submissions return a files[] array
instead of the legacy JSON-stringified sourceCode hack.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task W1.3: Verdict detail write path (worker → S3)

**Files:**

- Modify: `apps/worker/src/activities/judge.ts` (`completeSubmission` path)
- Modify: `packages/domain/src/submission/mutations.ts` (`completeJudge` — split incoming `SubmissionResult` into summary + detail)
- Update tests asserting verdictDetail shape

**Step 1: Update tests**

`tests/unit/domain/submission-complete*.test.ts`: replace `submission.verdictDetail` assertions with:

- `submission.verdictSummary.caseSummary.ac === 5`
- `submission.verdictDetailStorageKey === "submissions/<id>/verdict-detail.json"`
- `getVerdictDetail(submission.id)` returns full caseResults

**Step 2: Implement summary derivation**

```ts
// packages/domain/src/submission/mutations.ts
function deriveVerdictSummary(result: SubmissionResult): VerdictSummary {
  const counts = { ac: 0, wa: 0, tle: 0, mle: 0, re: 0, other: 0 };
  for (const c of result.caseResults ?? []) counts[c.verdict] = (counts[c.verdict] ?? 0) + 1;
  return {
    caseSummary: counts,
    subtaskSummary: result.subtaskResults?.map((s) => ({ id: s.id, score: s.score })),
    compilerErrorTruncated: result.compilerOutput?.slice(0, 1024),
  };
}

// completeJudge: write detail to S3 first, then DB row
await putVerdictDetail(storage(), submissionId, result);
await submissionRepo.update(submissionId, {
  status: result.verdict === "accepted" ? "accepted" : "completed",
  verdict: result.verdict,
  score: result.score,
  verdictSummary: deriveVerdictSummary(result),
  verdictDetailStorageKey: submissionVerdictDetailKey(submissionId),
  runtimeMs: result.runtimeMs,
  memoryKb: result.memoryKb,
});
```

**Step 3: Run worker tests + integration**

Run: `pnpm vitest run tests/unit/domain/submission-complete`
Run: `pnpm test:integration tests/integration/judge`

**Step 4: typecheck + lint clean**

**Step 5: Commit**

```bash
git add apps packages tests
git commit -m "feat(submission): write verdict detail to S3, keep summary in DB

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

> **W1 gate:** `pnpm typecheck && pnpm lint && pnpm test:unit` all green; `pnpm test:integration` green for judge + submission paths.

---

## Wave 2 — Parallel (file-disjoint)

### Task W2.A: Editorial context gate

**Files:**

- Modify: `packages/domain/src/editorial/queries.ts` (`canViewEditorials` signature)
- Modify: `apps/web/src/routes/api/problems/[id]/editorials/+server.ts`
- Modify: `apps/web/src/routes/(app)/problems/[problemId]/editorials/+page.server.ts`
- Modify: `apps/web/src/routes/(app)/problems/[problemId]/+page.server.ts`
- Create: `tests/unit/domain/editorial-context-gate.test.ts`

**Step 1: Write failing test**

```ts
describe("canViewEditorials context", () => {
  it("allows AC + practice context", async () => {
    expect(await canViewEditorials(userId, problemId, { kind: "practice" })).toBe(true);
  });
  it("blocks AC + contest in progress", async () => {
    expect(await canViewEditorials(userId, problemId,
      { kind: "contest", contestId, now: midContest })).toBe(false);
  });
  it("allows AC + contest after endsAt", async () => {
    expect(await canViewEditorials(userId, problemId,
      { kind: "contest", contestId, now: afterContest })).toBe(true);
  });
  it("blocks AC + assignment before closesAt", async () => { ... });
  it("blocks AC + exam in progress", async () => { ... });
  it("allows editorial author regardless of context (grandfather)", async () => { ... });
});
```

**Step 2: Implement**

```ts
export type EditorialViewContext =
  | { kind: "practice" }
  | { kind: "contest"; contestId: string; now: Date }
  | { kind: "assignment"; assignmentId: string; now: Date }
  | { kind: "exam"; examId: string; now: Date };

export async function canViewEditorials(
  userId: string,
  problemId: string,
  context: EditorialViewContext = { kind: "practice" },
): Promise<boolean> {
  const authored = await editorialRepo.existsForUserProblem(userId, problemId);
  if (authored) return true;
  const ac = await hasUserAcProblem(userId, problemId);
  if (!ac) return false;
  if (context.kind === "practice") return true;
  // any non-practice context: only after the gate closes
  if (context.kind === "contest") {
    const contest = await contestRepo.findById(context.contestId);
    return !contest || context.now >= contest.endsAt;
  }
  if (context.kind === "assignment") {
    /* check closesAt */
  }
  if (context.kind === "exam") {
    /* check endsAt */
  }
  return false;
}
```

In the API route, read `event.url.searchParams.get("context")` (one of `practice|contest|assignment|exam`) + id; default `practice`. Page loaders pass the same.

**Step 3: Test green**

Run: `pnpm vitest run tests/unit/domain/editorial`

**Step 4: typecheck + lint**

**Step 5: Commit**

```bash
git add packages apps tests
git commit -m "fix(editorial): require non-practice contexts to be closed

Closes the API-layer bypass where students could fetch
/api/problems/<id>/editorials directly during a contest if they had
AC'd the problem in past practice.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task W2.B: MOSS rewrite — read sources via S3

**Files:**

- Modify: `packages/domain/src/plagiarism/queries.ts` — `listSubmissionsForCheck`, `getPlagiarismSourceCode`
- Modify: `apps/worker/src/activities/plagiarism.ts` (or `packages/temporal/src/activities/plagiarism.ts` — grep first)
- Add integration test in `tests/integration/plagiarism/multi-file.test.ts`

**Step 1: Failing integration test**

Two submissions of the same multi-file problem with semantically equivalent code but renamed variables / shuffled file order should land in MOSS's flagged pairs (high similarity). Pre-fix this fails because the JSON-string blob's similarity is masked by JSON syntax noise.

```ts
it("flags semantically equivalent multi-file submissions", async () => {
  const subA = await seedMultiFileSubmission({
    files: [
      { path: "main.cpp", content: "int main() { /* solveA */ }" },
      { path: "util.cpp", content: "/* utilA */" },
    ],
  });
  const subB = await seedMultiFileSubmission({
    files: [
      { path: "main.cpp", content: "int main() { /* solveA renamed */ }" },
      { path: "util.cpp", content: "/* utilA */" },
    ],
  });
  const report = await runPlagiarismCheck({ assessmentId });
  expect(
    report.pairs.find(
      (p) =>
        [p.left.userId, p.right.userId].sort().join() ===
        [subA.userId, subB.userId].sort().join(),
    )?.similarity,
  ).toBeGreaterThan(0.7);
});
```

**Step 2: Update `listSubmissionsForCheck` to pull sources**

```ts
export async function listSubmissionsForCheck(
  target: PlagiarismTarget,
): Promise<PlagiarismSubmission[]> {
  const rows = await submissionRepo.findForPlagiarism({
    ...plagiarismTargetFilter(target),
    status: "accepted",
  });
  return Promise.all(
    rows.map(async (row) => {
      const sources = await getSubmissionSources(row.id);
      // Concatenate by sorted path, separated by file boundary marker
      // (markers are stripped by language tokenizers naturally)
      const merged = sources.map((s) => `// === ${s.path} ===\n${s.content}`).join("\n");
      return {
        id: row.id,
        userId: row.userId,
        problemId: row.problemId,
        language: row.language,
        score: row.score,
        sourceCode: merged,
      };
    }),
  );
}
```

Same fix to `getPlagiarismSourceCode` — return the merged string for the staff diff view; UI later can render per-file tabs from `getSubmissionSources` directly.

**Step 3: Run integration**

Run: `pnpm test:integration tests/integration/plagiarism`

**Step 4: typecheck + lint clean**

**Step 5: Commit**

```bash
git add packages tests
git commit -m "fix(plagiarism): read sources via storage; concatenate multi-file by sorted path

Multi-file submissions previously hit Dolos as a JSON-stringified blob,
which masked semantic similarity behind JSON syntax tokens. Reading
files individually and concatenating restores tokenization fidelity.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task W2.C: db:seed rewrite

**Files:**

- Modify: `packages/db/prisma/seed.ts` — every `submission.create({ sourceCode: ... })` call becomes:
  1. Generate cuid for the submission
  2. `putSubmissionSources(storage, submissionId, [{ path: "main.<ext>", content: ... }])`
  3. `submissionRepo.create({ id: submissionId, sourceStoragePrefix: submissionSourcePrefix(submissionId), ... })`
  4. For "completed" demo submissions: also `putVerdictDetail(storage, id, demoVerdict)` and set `verdictSummary` + `verdictDetailStorageKey`
- Modify: any helper inside `seed.ts` that constructs submissions in bulk

**Step 1: Update inline tests (if any in seed)** — `seed.ts` doesn't have its own tests; the integration test is `pnpm db:seed && pnpm test:integration` running clean.

**Step 2: Implement** — straight refactor; touch every `sourceCode:` literal in the file.

**Step 3: Smoke test**

```bash
pnpm db:push        # ensure schema is fresh
pnpm db:seed        # run rewritten seed
# Expected: no errors; output reports N submissions created.
```

Then verify a couple of MinIO keys exist:

```bash
docker exec nojv-minio mc ls local/nojv/submissions/ | head -5
```

(or via `aws --endpoint-url=http://localhost:9000 s3 ls`)

**Step 4: typecheck + lint clean**

**Step 5: Commit**

```bash
git add packages/db
git commit -m "feat(seed): write demo submission sources to S3

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

> **W2 gate:** `pnpm ci:verify` end-to-end green (typecheck + lint + unit + integration). This is the natural mid-PR checkpoint — if it's red, do not start W3.

---

## Wave 3 — New upload routes (parallel x5)

Pattern shared by all five tasks:

- Route is `POST /api/problems/[id]/...`
- Guard: `requireApiAuth` + `assertProblemEditAccess(actor, problemId)` + `writeApiRateLimiter`
- Size limits enforced server-side from `Content-Length` AND post-read byte count
- New helper `assertProblemStorageBudget(problemId, deltaBytes)` in `packages/domain/src/problem/storage-budget.ts` — counts current S3 usage under `problems/{id}/` prefix; rejects if `current + delta > 50_000_000`
- Audit log: `auditLogRepo.create({ kind: "problem_upload", actorId, problemId, meta: { path, size } })`

### Task W3.A: Workspace file upload route

**Files:**

- Create: `apps/web/src/routes/api/problems/[id]/workspace/files/+server.ts`
- Create: `tests/integration/web/api-problems-workspace-upload.test.ts`
- Modify: `packages/domain/src/problem/workspace.ts` — add `setWorkspaceFile(problemId, file)` helper that wraps `putText` + DB metadata upsert

**Step 1: Failing test (3 cases)**

```ts
it("teacher uploads a workspace file", async () => {
  const res = await POST("/api/problems/p1/workspace/files", {
    body: new FormData([
      ["path", "main.py"],
      ["language", "python"],
      ["visibility", "editable"],
      ["file", new Blob(["print('hi')"])],
    ]),
    actor: teacher,
  });
  expect(res.status).toBe(200);
  const updated = await problemRepo.findById("p1");
  expect(updated.workspaceFiles.find(f => f.path === "main.py")).toBeDefined();
});
it("student is rejected with 403", async () => { ... });
it("file exceeding 5 MB is rejected with 413", async () => { ... });
```

**Step 2: Implement**

```ts
export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const problemId = requireParam(event, "id");
  await assertProblemEditAccess(actor, problemId);
  const form = await event.request.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) throw new HttpError("file required", 400);
  if (file.size > 5 * 1024 * 1024) throw new HttpError("file too large", 413);
  const path = String(form.get("path") ?? "");
  const language = String(form.get("language") ?? "");
  const visibility = String(form.get("visibility") ?? "editable");
  await assertProblemStorageBudget(problemId, file.size);
  const content = await file.text();
  await problemDomain.setWorkspaceFile(problemId, { path, language, visibility, content });
  return json(await problemDomain.getProblemDetail(problemId));
});
```

**Step 3-5: Test green / typecheck / lint / commit**

```bash
git commit -m "feat(problem): workspace file upload route"
```

---

### Task W3.B: Checker upload route

Pattern identical to W3.A, but writes to `checkerKey(problemId)` + flips `problem.judgeConfig.checker.source` accordingly. Same 5 MB cap.

**File:** `apps/web/src/routes/api/problems/[id]/checker/+server.ts`
**Test:** `tests/integration/web/api-problems-checker-upload.test.ts`

Commit: `feat(problem): checker source upload route`

---

### Task W3.C: Interactor upload route

Same shape as checker; key `interactorKey(problemId)`; `problem.judgeConfig.interactor.source` updated.

**File:** `apps/web/src/routes/api/problems/[id]/interactor/+server.ts`
**Test:** `tests/integration/web/api-problems-interactor-upload.test.ts`

Commit: `feat(problem): interactor source upload route`

---

### Task W3.D: Zip bundle import route

**Files:**

- Create: `apps/web/src/routes/api/problems/[id]/bundle/+server.ts` (POST)
- Create: `packages/domain/src/problem/bundle.ts` — `importBundle(actor, problemId, zipBuffer)`
- Create: `tests/integration/web/api-problems-bundle-import.test.ts`
- Modify: `packages/domain/package.json` — depend on `unzipper`

**Step 1: Failing tests (5 cases)**

```ts
it("imports a valid bundle (testcases + workspace + checker)", async () => { ... });
it("rejects bundle exceeding 50 MB total uncompressed", async () => { ... });
it("rejects bundle with a path containing ..", async () => { ... });
it("rejects bundle with absolute paths", async () => { ... });
it("rejects bundle with > 200 entries", async () => { ... });
```

**Step 2: Implement**

```ts
// packages/domain/src/problem/bundle.ts
import { Open } from "unzipper";

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_ENTRIES = 200;

export async function importBundle(actor: Actor, problemId: string, zipBuffer: Buffer) {
  await assertProblemEditAccess(actor, problemId);
  const archive = await Open.buffer(zipBuffer);
  if (archive.files.length > MAX_ENTRIES) throw new ConflictError("Too many entries");
  let total = 0;
  for (const f of archive.files) total += f.uncompressedSize;
  if (total > MAX_BYTES) throw new ConflictError("Bundle exceeds 50 MB");

  const testcases: { index: number; field: "input" | "answer"; content: string }[] = [];
  const workspace: { path: string; content: string }[] = [];
  let checker: { lang: string; content: string } | null = null;
  let interactor: { lang: string; content: string } | null = null;

  for (const entry of archive.files) {
    if (entry.path.includes("..") || entry.path.startsWith("/")) {
      throw new ConflictError(`Invalid path: ${entry.path}`);
    }
    const buf = await entry.buffer();
    // dispatch by prefix
    if (entry.path.startsWith("testcases/")) {
      const m = /^testcases\/(\d+)\/(input|answer)\.txt$/.exec(entry.path);
      if (!m) continue;
      testcases.push({
        index: Number(m[1]),
        field: m[2] as any,
        content: buf.toString("utf8"),
      });
    } else if (entry.path.startsWith("workspace/")) {
      workspace.push({
        path: entry.path.slice("workspace/".length),
        content: buf.toString("utf8"),
      });
    } else if (/^checker\.(cpp|py|js)$/.test(entry.path)) {
      checker = { lang: extToLang(entry.path), content: buf.toString("utf8") };
    } else if (/^interactor\.(cpp|py|js)$/.test(entry.path)) {
      interactor = { lang: extToLang(entry.path), content: buf.toString("utf8") };
    }
  }

  // Apply atomically: gather all S3 puts + DB updates, run DB updates in one tx
  // Storage puts are best-effort post-tx (same pattern as submission write)
  await runTransaction(async (tx) => {
    /* replace problem.workspaceFiles[], testcase sets, checker/interactor metadata */
  });
  await Promise.all([
    ...testcases.map((t) =>
      putText(storage(), testcaseKey(problemId, t.index, t.field), t.content),
    ),
    ...workspace.map((w) => putText(storage(), workspaceFileKey(problemId, w.path), w.content)),
    checker ? putText(storage(), checkerKey(problemId), checker.content) : Promise.resolve(),
    interactor
      ? putText(storage(), interactorKey(problemId), interactor.content)
      : Promise.resolve(),
  ]);
}
```

**Route** (`+server.ts`): read `event.request.arrayBuffer()`, cap upload at 60 MB (gives margin over 50 MB uncompressed budget); call `importBundle`.

**Step 3-5: Tests / typecheck / lint / commit**

Commit: `feat(problem): zip bundle import for testcases/workspace/checker`

---

### Task W3.E: Zip bundle export route

**Files:**

- Create: `apps/web/src/routes/api/problems/[id]/bundle/+server.ts` (GET — same file as W3.D's POST)
- Create: `packages/domain/src/problem/bundle.ts` — `exportBundle(actor, problemId): Promise<Buffer>` (same file as W3.D)
- Create: `tests/integration/web/api-problems-bundle-export.test.ts`
- Modify: `packages/domain/package.json` — depend on `archiver`

**Coordination with W3.D:** W3.D and W3.E share `packages/domain/src/problem/bundle.ts` and the route file. If both subagents are dispatched, W3.E waits on W3.D's commit. Recommend sequencing W3.D → W3.E rather than parallel.

**Step 1: Failing round-trip test**

```ts
it("round-trips: export then import yields equivalent problem", async () => {
  await seedProblemWithFixture("classic-multi-file");
  const exported = await exportBundle(staff, problemId);
  await wipeProblemStorage(problemId);
  await importBundle(staff, problemId, exported);
  const after = await problemRepo.findById(problemId);
  expect(after.workspaceFiles).toEqual(before.workspaceFiles);
  // (also assert testcases + checker)
});
```

**Step 2: Implement**

```ts
import archiver from "archiver";
import { Writable } from "node:stream";

export async function exportBundle(actor: Actor, problemId: string): Promise<Buffer> {
  await assertProblemEditAccess(actor, problemId);
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(c, _, cb) {
      chunks.push(c);
      cb();
    },
  });
  const zip = archiver("zip", { zlib: { level: 9 } });
  zip.pipe(sink);

  const problem = await problemDomain.getProblemDetail(problemId);
  for (const ts of problem.testcaseSets) {
    for (const [i, tc] of ts.testcases.entries()) {
      zip.append(tc.input, { name: `testcases/${i}/input.txt` });
      if (tc.output) zip.append(tc.output, { name: `testcases/${i}/answer.txt` });
    }
  }
  for (const wf of problem.workspaceFiles) {
    zip.append(wf.content, { name: `workspace/${wf.path}` });
  }
  if (problem.checker) {
    zip.append(await getText(storage(), checkerKey(problemId)), {
      name: `checker.${problem.checker.lang}`,
    });
  }
  if (problem.interactor) {
    /* ditto */
  }

  await zip.finalize();
  return Buffer.concat(chunks);
}
```

Route GET: `return new Response(buf, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="problem-${problemId}.zip"` } })`.

**Step 3-5: Test / typecheck / lint / commit**

Commit: `feat(problem): zip bundle export round-tripping with import`

> **W3 gate:** all four upload paths + bundle round-trip green; `pnpm ci:verify` green.

---

## Wave 4 — UI + docs (parallel x2)

### Task W4.A: Problem-author UI integration

**Files:**

- Modify: `apps/web/src/lib/components/problem/tabs/judge/*.svelte` — locate the workspace / checker / interactor tabs; add a drag-drop zone above the existing Monaco editor; add a "Import bundle…" / "Export bundle" button group; show "X.X MB / 50 MB" budget bar
- Modify: `apps/web/src/lib/components/problem/tabs/judge/+page.svelte` (or sibling)
- Add Playwright e2e if practical: `tests/e2e/problem-bundle.spec.ts`

**Step 1-5:** Visual changes; verify with `pnpm dev` + browser. Unit-coverable parts (budget bar formatting, drag-drop accept regex) get vitest tests. Commit per logical chunk.

Final commit: `feat(ui): bundle import/export + drag-drop in problem authoring`

---

### Task W4.B: Docs sync

**Files:**

- Modify: `docs/architecture/DATABASE.md` — Submission schema section (drop sourceCode/verdictDetail; describe sourceStoragePrefix + verdictSummary + verdictDetailStorageKey)
- Modify: `docs/architecture/JUDGE_PIPELINE.md` — submission data-flow diagram (sources via S3)
- Modify: `docs/operations/SECURITY.md` — note editorial context gate, ack the multi-file MOSS fix
- Modify: `docs/specs/editorials.md` (if exists; else add note in nearest spec) — visibility rule including context
- Modify: `docs/operations/QUALITY_SCORE.md` — record the audit findings as resolved

Single commit: `docs: sync architecture/security/spec to storage-unification changes`

---

## Wave 5 — Final verification

### Task W5: ci:verify + cleanup

**Steps:**

1. Run: `pnpm ci:verify` — expect 100% green
2. Run: `pnpm db:push && pnpm db:seed && pnpm dev` — smoke test the seeded app (open `/(app)/problems`, submit a sample, verify verdict)
3. Update `docs/plans/active/` — move this file to `docs/plans/completed/`
4. `git log --oneline feat/storage-unification ^main | cat` — sanity check commit log
5. Push branch + open PR:

```bash
git push -u origin feat/storage-unification
gh pr create --title "feat: storage unification + multi-file uploads + audit fixes" \
  --body "$(cat <<'EOF'
## Summary

Three coupled changes:

1. **Storage unification** — `Submission.sourceCode` and the heavy part of `Submission.verdictDetail` moved out of Postgres into S3 under `submissions/{id}/`. DB keeps a small `verdictSummary` for list views.
2. **Audit fixes (from 2026-05-28 sweep)** — `canViewEditorials` now takes a context arg; multi-file MOSS reads individual sources from S3 instead of a JSON-stringified blob.
3. **New problem-author uploads** — single-file workspace/checker/interactor uploads + zip bundle import/export.

## Breaking changes (pre-production only)

- `sourceCode TEXT` and `verdictDetail JSONB` columns dropped.
- `db:seed` rewritten to write demo submissions to S3.

## How to verify

- `pnpm ci:verify` should be green
- Open the seeded app, submit a sample, confirm verdict displays
- Drag-drop a workspace file onto the judge tab; should upload and persist
- Export a problem, wipe it, re-import — equivalence preserved

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(merge decision left to user; do not auto-merge)

---

## Subagent dispatch ordering

```
Wave 0 : W0.1 → W0.2                             (sequential, 1 agent each)
Wave 1 : W1.1 → W1.2 → W1.3                      (sequential, 1 agent each)
Wave 2 : [W2.A | W2.B | W2.C]                    (3 agents in parallel)
Wave 3 : [W3.A | W3.B | W3.C | W3.D]             (4 in parallel)
         → W3.E (after W3.D commits the shared bundle.ts/route file)
Wave 4 : [W4.A | W4.B]                           (2 in parallel)
Wave 5 : W5                                       (manual, 1 agent)
```

Between waves: `pnpm ci:verify` must be green. Subagents are dispatched fresh per task; each receives the relevant section above as its instructions and only its task's file paths in scope.
