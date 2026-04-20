# Dolos Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the MOSS TCP-socket plagiarism activity with an
in-process Dolos-based implementation, without touching the existing
domain module / API / UI contract surface. Ship the
`SimilarityPair` shape change, the `plagiarismMossReportUrl`
column rename, the activity rewrite, UI adjustments, and updated
tests / docs in one consistent rollout.

**Architecture:** `@dodona/dolos-lib` becomes a runtime dep of
`@nojv/temporal` only. The existing domain split is preserved —
Dolos is not pulled into `@nojv/domain` or the web image. The
activity keeps its public shape (`runPlagiarismCheck(targetId,
targetType)`); only its body and the pair model change. One-shot
cutover, no feature flag.

**Tech Stack:** `@dodona/dolos-lib`, Prisma 7 migration,
`@nojv/domain` type tweak, `@nojv/temporal` activity rewrite,
SvelteKit 5 UI adjustment, Vitest, paraglide.

**Reference design:** `docs/plans/active/2026-04-20-dolos-migration-design.md`.

**Prerequisite:** None. MOSS and Dolos paths do not coexist at
runtime; the migration is an atomic swap within one release train.

**Conventions:** Same as the 2026-04-19 plans (notification center,
clarification board, rejudge + score override). Every task ends with
a commit. Commits use conventional-commit style. Run the minimal
verifier (`pnpm -w typecheck`, relevant
`pnpm exec vitest run --project unit <file>`, `pnpm lint`) before
moving on.

---

## Phase 1 — Types + schema (commit group "feat: Dolos pair shape + column rename")

### Task 1: Rewrite `SimilarityPair` + `PlagiarismResults`

**Files:**

- Modify: `packages/domain/src/plagiarism/types.ts`

**Step 1: Replace the interface**

```ts
export interface SimilarityPair {
  problemId: string;
  userId1: string;
  userId2: string;
  similarity: number; // 0..100, Dolos symmetric metric
  longestFragment: number; // longest common AST fragment (tokens)
  totalOverlap: number; // total overlapping AST tokens
}

export interface PlagiarismResults {
  pairs: SimilarityPair[];
}
```

`PlagiarismTarget` and `plagiarismTargetFilter` stay as-is.

**Step 2: Fix the type fallout**

`pnpm -w typecheck` will flag every consumer of the old fields. Expected
locations:

- `packages/temporal/src/activities/plagiarism.ts` — the activity
  body still constructs the old shape. Leave the errors for Task 5.
- `apps/web/src/lib/components/.../AssignmentPlagiarismReport.svelte`
  — the bucketing / rendering logic reads `similarity1` and
  `mossUrl`. Leave for Task 7.

For this task, allow the type errors to remain; they're cleaned up in
later tasks.

**Step 3: Commit**

```bash
git add packages/domain/src/plagiarism/types.ts
git commit -m "feat(domain): Dolos-shaped SimilarityPair"
```

Note: this commit intentionally lands a failing typecheck. Land with
`--no-verify` only if a pre-commit hook blocks it; otherwise use the
following tasks to clear the errors before pushing. Do not break main
— complete the series before pushing.

---

### Task 2: Prisma migration — rename `plagiarismMossReportUrl` → `plagiarismReportUrl`

**Files:**

- Modify: `packages/db/prisma/schema/course.prisma` (`CourseAssessment` model)
- Modify: `packages/db/prisma/schema/contest.prisma` (`Exam` + `Contest` models)
- Create: `packages/db/prisma/migrations/20260420000000_rename_plagiarism_report_url/migration.sql`

**Step 1: Rename the column in all three models**

Each of `CourseAssessment`, `Exam`, `Contest` has a
`plagiarismMossReportUrl String?` field. Rename to
`plagiarismReportUrl String?` in the schema files.

**Step 2: Write the migration**

```sql
-- packages/db/prisma/migrations/20260420000000_rename_plagiarism_report_url/migration.sql
ALTER TABLE "CourseAssessment" RENAME COLUMN "plagiarismMossReportUrl" TO "plagiarismReportUrl";
ALTER TABLE "Exam" RENAME COLUMN "plagiarismMossReportUrl" TO "plagiarismReportUrl";
ALTER TABLE "Contest" RENAME COLUMN "plagiarismMossReportUrl" TO "plagiarismReportUrl";
```

`RENAME COLUMN` preserves existing data — historical MOSS URLs keep
living in the renamed column until the next fresh run overwrites.

**Step 3: Regenerate + push**

```bash
pnpm db:generate
pnpm db:push
```

Confirm `psql $DATABASE_URL -c '\d "CourseAssessment"'` shows
`plagiarismReportUrl` and no `plagiarismMossReportUrl`.

**Step 4: Commit**

```bash
git add packages/db/prisma/schema packages/db/prisma/migrations/20260420000000_rename_plagiarism_report_url
git commit -m "feat(db): rename plagiarismMossReportUrl → plagiarismReportUrl"
```

---

### Task 3: Update `plagiarismRepo` to use the new column name

**Files:**

- Modify: `packages/db/src/repositories/plagiarism.ts`

**Step 1: Sweep the file**

Every reference to `mossReportUrl` (field or Prisma selector) becomes
`reportUrl`. Every `upsertFor*` method that accepts an input object
takes `reportUrl?: string | null` in place of
`mossReportUrl?: string | null`.

`PlagiarismReportSummary` (exported type) gains `reportUrl`; drops
`mossReportUrl`.

**Step 2: Update the domain persist surface**

`packages/domain/src/plagiarism/queries.ts:53-64` has
`saveResults(target, results, mossReportUrl)` — rename the parameter
to `reportUrl` and pass it through as
`writePlagiarismFields(target, { ..., reportUrl })`.

**Step 3: Typecheck + test**

```bash
pnpm -w typecheck
```

The domain + repo layer should typecheck. The activity + UI still
won't; that's expected.

`pnpm exec vitest run --project unit tests/unit/domain/plagiarism-queries.test.ts`
should still pass — the existing tests don't assert on
`mossReportUrl` directly, but if any test breaks, swap the field name.

**Step 4: Commit**

```bash
git add packages/db/src/repositories/plagiarism.ts packages/domain/src/plagiarism/queries.ts
git commit -m "feat(db,domain): plumb reportUrl through repo + domain"
```

---

## Phase 2 — Activity rewrite (commit group "feat: Dolos-based plagiarism")

### Task 4: Add `@dodona/dolos-lib` to `@nojv/temporal`

**Files:**

- Modify: `packages/temporal/package.json`
- Regenerate: `pnpm-lock.yaml`

**Step 1: Add the dep**

```bash
pnpm add --filter @nojv/temporal @dodona/dolos-lib
```

Pick the latest stable; pin with `^` for minor upgrades.

**Step 2: Verify native prebuilds resolved**

After `pnpm install`, check:

```bash
ls node_modules/.pnpm/@dodona+dolos-lib*/node_modules/@dodona/dolos-lib/dist/
```

Expect compiled grammar `.node` files for the current host
(linux-x64, linux-arm64, darwin-arm64, etc.). If prebuilds are
missing for a platform we ship to, Docker builds will fall back to
source compilation — flag it as a follow-up (update
`worker.Dockerfile` builder stage to add `build-essential python3`).

**Step 3: Commit**

```bash
git add packages/temporal/package.json pnpm-lock.yaml
git commit -m "feat(temporal): add @dodona/dolos-lib dependency"
```

---

### Task 5: Rewrite `runPlagiarismCheck` against Dolos

**Files:**

- Rewrite: `packages/temporal/src/activities/plagiarism.ts`

**Step 1: Drop the MOSS socket code**

Remove:

- `submitToMoss` (lines ~51–128)
- `MOSS_LANGUAGE_MAP` + `getMossLanguage`
- `import * as net from "node:net"`
- The `process.env.MOSS_USER_ID` branch.

**Step 2: Add Dolos-based grouping**

Keep:

- `PlagiarismTargetType` alias
- `extensionForLang` (Dolos needs file names with real extensions so
  its language auto-detection stays correct if we ever drop the
  explicit `language` option)
- The dedup-by-best-score loop
- The `groups: Map` grouping on `(problemId, language)`
- Status update + failure path + rethrow

**Step 3: Call Dolos per group**

```ts
import { Dolos } from "@dodona/dolos-lib";

// inside the loop over groups:
const dolos = new Dolos({ language: group.language });
const report = await dolos.analyze(
  group.subs.map((sub) => ({
    path: `${sub.userId}.${extensionForLang(group.language)}`,
    content: sub.sourceCode,
  })),
);

for (const pair of report.pairs) {
  allPairs.push({
    problemId: group.problemId,
    userId1: pair.leftFile.path.replace(/\..+$/, ""),
    userId2: pair.rightFile.path.replace(/\..+$/, ""),
    similarity: Math.round(pair.similarity * 100),
    longestFragment: pair.longestFragment,
    totalOverlap: pair.totalOverlapTokens,
  });
}
```

Verify the actual property names match whichever Dolos version the
lockfile resolves to (`report.pairs`, `pair.similarity`, etc.). The
design doc's names are approximate.

**Step 4: Save with `null` report URL**

The final line becomes:

```ts
await plagiarismDomain.saveResults(target, { pairs: allPairs }, null);
```

No external report URL to record — everything is in-memory.

**Step 5: Typecheck**

```bash
pnpm -w typecheck
```

Should be clean now — activity matches new `SimilarityPair` shape.

**Step 6: Commit**

```bash
git add packages/temporal/src/activities/plagiarism.ts
git commit -m "feat(temporal): Dolos-based plagiarism activity"
```

---

### Task 6: Rewrite the activity tests

**Files:**

- Modify: `tests/unit/temporal/plagiarism-activity.test.ts`

**Step 1: Delete MOSS-specific cases**

Drop the tests that assert MOSS bucketing semantics:

- `pairs c + go + rust together under the shared MOSS 'c' bucket`
- `keeps cpp in the 'cc' bucket separate from the c-family bucket`

The "shared bucket" concept doesn't exist in Dolos — every language
has its own parser.

**Step 2: Mock `@dodona/dolos-lib`**

Add a hoisted mock for the `Dolos` class so tests don't spawn real
tree-sitter parsers. Example:

```ts
const { analyze } = vi.hoisted(() => ({ analyze: vi.fn() }));
vi.mock("@dodona/dolos-lib", () => ({
  Dolos: vi.fn(() => ({ analyze })),
}));
```

Default `analyze.mockResolvedValue({ pairs: [] })` in `beforeEach`;
override per test.

**Step 3: Update assertions**

- Best-score dedup test: unchanged idea, but assert on the `files`
  array passed to `analyze` (two files, one per winning submission)
  rather than pair count.
- Single-submission skip: unchanged.
- Unmapped language skip: delete — Dolos's supported set is a
  superset of `SupportedLanguage`. Add a guard test that an
  unrecognized language string still short-circuits safely, not via
  Dolos call.
- New test: `emits similarity as 0-100 integer` — mock `analyze`
  returning `{ pairs: [{ leftFile: ..., rightFile: ..., similarity:
0.73, longestFragment: 12, totalOverlapTokens: 40 }] }`; assert the
  saved pair has `similarity: 73`.

**Step 4: Run**

```bash
pnpm exec vitest run --project unit tests/unit/temporal/plagiarism-activity.test.ts
```

All cases green.

**Step 5: Commit**

```bash
git add tests/unit/temporal/plagiarism-activity.test.ts
git commit -m "test(temporal): Dolos-based plagiarism activity"
```

---

## Phase 3 — UI + docs (commit group "feat: Dolos UI surface")

### Task 7: Update the staff plagiarism report component

**Files:**

- Modify: `apps/web/src/lib/components/.../AssignmentPlagiarismReport.svelte`
  (path from `docs/specs/plagiarism.md` — verify at task start)

**Step 1: Collapse the similarity column**

Replace the `similarity1 / similarity2` rendering with a single
`similarity` column. Keep the High / Medium / Low bucketing
thresholds (≥ 70 / 50–70 / < 50) — Dolos's 0–100 semantics match.

**Step 2: Add `longestFragment` column**

A second column alongside similarity showing the longest common AST
fragment. Format: `N tokens` or just `N`. Useful for distinguishing
"one obviously copied block" from "many small coincidences".

**Step 3: Replace the MOSS deep link**

The per-pair link currently points at `pair.mossUrl` (external).
Replace with a button that opens a dialog fetching
`/api/plagiarism/[assessmentId]?source=true&userId=<uid>&problemId=<pid>`
for each of `userId1` and `userId2`, rendered side-by-side.

If the side-by-side source viewer component doesn't exist yet, stub
with a dialog that just shows the two source strings in `<pre>`
blocks. Polishing the diff view is a follow-up.

**Step 4: Update paraglide keys if any strings moved**

Run `pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`
from inside `apps/web` after editing messages.

**Step 5: Commit**

```bash
git add apps/web/src/lib/components apps/web/messages
git commit -m "feat(web): Dolos-shape plagiarism table + in-product source dialog"
```

---

### Task 8: Update the plagiarism spec

**Files:**

- Modify: `docs/specs/plagiarism.md`

**Step 1: Update the Scope section**

- Change "MOSS language mapping" bullet to "per-language native
  parser (Dolos tree-sitter grammars)". Remove the c/go/rust shared
  bucket and cpp-separate-cc GIVEN/WHEN/THEN cases.
- Add a GIVEN/WHEN/THEN: "every `SupportedLanguage` has a dedicated
  parser and is never bucketed with another language".
- Remove mentions of `moss.stanford.edu`, socket timeouts, and the
  "MOSS rejected the user ID" error path.
- Add: "activity runs entirely in-process; no third-party network
  dependency".

**Step 2: Update the Data shape section**

Rewrite `SimilarityPair` in the "Results retrieval" bullet list and
the Implementation References / Schema section to reflect the new
interface.

**Step 3: Update Implementation References**

- Add: `@dodona/dolos-lib` under Temporal.
- Remove the MOSS socket protocol detail + `MOSS_USER_ID` env.
- Update the `mossReportUrl` mentions to `reportUrl`.

**Step 4: Update the Open Questions**

- Delete the bullet about MOSS lacking Go/Rust support (now false).
- Delete the bullet about similarity placeholder zeros (now false).
- Keep the JPlag fallback bullet — Dolos is the primary, but
  mentioning JPlag as a further fallback is cheap insurance.

**Step 5: Commit**

```bash
git add docs/specs/plagiarism.md
git commit -m "docs(specs): update plagiarism spec for Dolos"
```

---

## Phase 4 — Deploy verification (commit group "build: Dolos-ready worker image")

### Task 9: Verify worker Docker image builds

**Files:**

- Modify (if needed): `infra/docker/worker.Dockerfile`

**Step 1: Build the image**

```bash
docker build -f infra/docker/worker.Dockerfile -t nojv-worker:dolos-test .
```

If the build fails with "node-gyp: build failed" or "tree-sitter:
prebuild not found for this platform", add to the builder stage:

```dockerfile
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential python3 \
 && rm -rf /var/lib/apt/lists/*
```

Before the `pnpm install --filter @nojv/worker...` line.

**Step 2: Verify grammar native modules shipped**

```bash
docker run --rm nojv-worker:dolos-test \
  find /app/node_modules/@dodona -name '*.node' | head -20
```

Expect several native module files. If empty, the prebuild resolution
failed — revisit dep layering.

**Step 3: Measure image size delta**

```bash
docker images | grep nojv-worker
```

Record the size increase in the commit message. Expect 15–25 MB.

**Step 4: Commit (if Dockerfile changed)**

```bash
git add infra/docker/worker.Dockerfile
git commit -m "build(worker): native addon toolchain for Dolos grammars"
```

If no Dockerfile change was needed, skip the commit.

---

### Task 10: Smoke test end-to-end

Manual verification — no commit.

**Step 1: Seed an assignment with multiple AC submissions**

Use the existing dev seed or create via UI: one assignment, one
problem, 3+ students submitting similar but non-identical Python or
C++ solutions.

**Step 2: Trigger the plagiarism check**

As a staff user, POST `/api/plagiarism/[assessmentId]`. Expect
status → pending → running → completed within a few seconds (Dolos
is fast on small inputs).

**Step 3: View the report**

Navigate to the Plagiarism tab. Verify:

- Pairs appear with numeric similarity scores (not all zeros).
- Bucketing (High / Medium / Low) looks sensible.
- Clicking a pair opens the source-code side-by-side dialog (or the
  stubbed version from Task 7).

**Step 4: Trigger re-run**

POST again. Expect the prior result to be wiped and a new one to land.

**Step 5: Simulate failure**

Temporarily force `fetchSubmissionsForCheck` to throw (e.g. rename
the target id). Expect status → failed and a UI error state.

---

## Final Verification

Run the full local CI:

```bash
pnpm -w typecheck    # 17/17 green
pnpm lint            # 18/18 green
pnpm -w format       # clean
pnpm test:unit       # plagiarism-activity.test.ts + plagiarism-queries.test.ts green
pnpm test:integration
```

All green.

---

## Notes for the Implementer

- The design doc is the source of truth on _why_; this plan is the
  source of truth on _what_ and _where_. When they conflict, re-read
  the design.
- Dolos's exact API shape may differ slightly from the sketches here
  — verify against the installed version's type definitions before
  writing the final activity code.
- `@dodona/dolos-lib` publishes prebuilds for common platforms; test
  Docker build early to catch any prebuild gaps before Task 9.
- The `plagiarismMossReportUrl` → `plagiarismReportUrl` column rename
  is destructive to downstream analytics queries that hard-code the
  old name. Grep the repo before applying to catch any such
  references (should be zero outside `plagiarism.ts` and the UI
  component, but verify).
- UI strings moved by Task 7 must be recompiled via paraglide after
  every message edit — `svelte-kit sync` alone is insufficient.
- Historical MOSS pair data in `plagiarismResults` JSON remains
  readable at the column level but breaks the new `SimilarityPair`
  type. The UI should tolerate the old shape gracefully (show
  "legacy MOSS result — re-run for details") or simply require
  staff to re-trigger. Decide in Task 7; default is the re-trigger
  path since historical reports are snapshots and staff typically
  re-run after testcase changes anyway.

---

## Related

- Design: `docs/plans/active/2026-04-20-dolos-migration-design.md`
- Spec: `docs/specs/plagiarism.md` (updated in Task 8)
- Current activity: `packages/temporal/src/activities/plagiarism.ts`
- Current types: `packages/domain/src/plagiarism/types.ts`
