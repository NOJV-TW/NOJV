# Problem Total Score (remove the 0–100 cap) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A problem's total score is `Σ subtask.weight` (no 0–100 normalization), so problems can be worth >100; contest 累分制 / exams / assignments all use that problem total as each problem's max, and teachers cannot hand-tune per-problem points there.

**Architecture:** Remove the `(rawScoreSum / totalWeight) * 100` normalization in `scoring.ts` so a submission's `score` is the sum of passed subtask weights. The three join tables (`ContestProblem` / `ExamProblem` / `AssessmentProblem`) keep their `points` column, but for total-based modes it is a **snapshot of the problem total taken at attach time** (frozen), not a teacher value. The only place a teacher still sets `points` is contest **積分制 (weighted_count)**, where `points` = the award on a full solve. No backward-compat / data-preservation migration — the dev DB is reseeded, and the seed script is updated to the new model.

**Tech Stack:** TypeScript ESM, Prisma 7, Zod 4, Vitest, SvelteKit. Scoring lives in `@nojv/application`, schemas in `@nojv/core`, repos in `@nojv/db`.

**Scope decisions (confirmed in brainstorming):**
- Model A: subtask weights ARE absolute points; problem total = `Σ weight`. (Single source of truth.)
- Full scope: contest + exam + assignment.
- No backward compatibility; reseed; **update the seed script**.
- Per-problem max for 累分制 / exam / assignment = **snapshot** of problem total at attach (editing the problem later does NOT retro-change a created exam/assignment).
- **advanced / `special_env` problems stay at total = 100** for now (their scorer emits 0–100; no subtasks to sum). `getProblemTotalScore` returns 100 for them. Expanding advanced >100 is an explicit follow-up, out of scope.
- No DB schema migration is expected (weight/points are already unbounded `Int`; the caps are Zod-only). If any task discovers a needed column change, add a normal additive migration.

**Out of scope / keep from the earlier review:** keep the already-landed `#5` contest-edit guard, `#6a` helper dedup, `#6b` dead-load removal. The earlier `#4` data migration (`20260629010000_collapse_legacy_scoring`) is already deleted (obsolete under "no backward compat").

---

## Phase 1 — Problem-total foundation (scoring core)

### Task 1.1: `getProblemTotalScore` helper

**Files:**
- Create: `packages/application/src/problem/total-score.ts`
- Test: `tests/unit/domain/problem/total-score.test.ts`

A problem's total = sum of its `TestcaseSet.weight` for standard problems; `100` for `special_env`.

**Step 1 — failing test.** Standard problem with weights `[80, 120]` → `200`; an empty/`special_env` problem → `100`.

```ts
import { describe, expect, it } from "vitest";
import { computeProblemTotalScore } from "@nojv/application";

describe("computeProblemTotalScore", () => {
  it("sums subtask weights for standard problems", () => {
    expect(computeProblemTotalScore({ type: "full_source", testcaseSets: [{ weight: 80 }, { weight: 120 }] })).toBe(200);
  });
  it("returns 100 for special_env (advanced) problems", () => {
    expect(computeProblemTotalScore({ type: "special_env", testcaseSets: [] })).toBe(100);
  });
  it("returns 100 when a standard problem has no testcase sets yet", () => {
    expect(computeProblemTotalScore({ type: "full_source", testcaseSets: [] })).toBe(100);
  });
});
```

**Step 2 — run, expect fail** (`pnpm vitest run tests/unit/domain/problem/total-score.test.ts`).

**Step 3 — implement.**

```ts
import type { ProblemType } from "@nojv/core";

export function computeProblemTotalScore(problem: {
  type: ProblemType;
  testcaseSets: { weight: number }[];
}): number {
  if (problem.type === "special_env") return 100;
  const sum = problem.testcaseSets.reduce((s, t) => s + t.weight, 0);
  return sum > 0 ? sum : 100;
}
```

Add a tx-aware async sibling for attach paths (sums weights via `testcaseSetRepo`):

```ts
import { testcaseSetRepo, type TransactionClient } from "@nojv/db";

export async function getProblemTotalScore(
  tx: TransactionClient,
  problem: { id: string; type: ProblemType },
): Promise<number> {
  if (problem.type === "special_env") return 100;
  const sets = await testcaseSetRepo.withTx(tx).findByProblemId(problem.id);
  const sum = sets.reduce((s, t) => s + t.weight, 0);
  return sum > 0 ? sum : 100;
}
```

Export both from `@nojv/application` (barrel in `packages/application/src/index.ts` / `problem/index.ts` as appropriate — match existing export style).

**Step 4 — run, expect pass. Step 5 — commit** `feat(scoring): add problem total-score helper`.

---

### Task 1.2: remove 0–100 normalization in `scoring.ts`

**Files:**
- Modify: `packages/application/src/submission/scoring.ts:158-164` and `:201-230`
- Test: `tests/unit/domain/scoring/*` + any `submission/scoring` test (find with `grep -rl mapResult tests`)

**Step 1 — update/extend the existing `mapResult` test** so a problem with subtask weights `[80, 120]`, passing only the first subtask, yields `score: 80` (not `round(80/200*100)=40`); passing both yields `200`.

**Step 2 — run, expect fail.**

**Step 3 — implement.** Replace the normalization:

```ts
// before
const totalWeight = subtaskResults.reduce((s, st) => s + st.weight, 0);
const rawScoreSum = subtaskResults.reduce((s, st) => s + st.rawScore, 0);
let score = totalWeight > 0 ? Math.round((rawScoreSum / totalWeight) * 100) : 0;
// after — subtask weights ARE the points; total = Σ weight
const totalWeight = subtaskResults.reduce((s, st) => s + st.weight, 0);
let score = subtaskResults.reduce((s, st) => s + st.rawScore, 0);
```

Full-AC gate at `:203` — replace the `score >= 100` magic number with "full marks = earned every weight":

```ts
// before:  if (allAc && score >= 100) {
// after:
if (allAc && score >= totalWeight) {
```

(`customScore` override at `:162` and `result.customScore ?? score` at `:210` stay as-is — advanced still overrides.)

**Step 4 — run, expect pass. Step 5 — commit** `feat(scoring): score = sum of subtask weights, drop 0–100 normalization`.

---

### Task 1.3: lift the `.max(100)` Zod caps

**Files (modify):**
- `packages/core/src/schemas/submission.ts:96` — `score: z.number().int().min(0)` (drop `.max(100)`)
- `packages/core/src/schemas/advanced-mode.ts:22` — keep `.max(100)` (advanced stays 100 per scope) **OR** raise only if Task scope expands; leave as-is for now and note it.
- `packages/core/src/schemas/problem.ts:137,144,150` — subtask `weight` `.max(100)` → `.max(100_000)` (keep `min(1)` / `min(0)`).

**Step 1 — test** in `tests/unit/core/` that a submission score `200` and a subtask weight `150` both `safeParse` successfully.
**Step 2 — fail. Step 3 — edit schemas. Step 4 — pass. Step 5 — commit** `feat(core): allow problem scores/weights above 100`.

---

### Task 1.4: clamp + fallback use the problem total, not 100

**Files:**
- Modify: `packages/application/src/submission/adjustments.ts:153` (`clampScore` caps at 100) and `:54` (time-bonus can exceed total)
- Modify: `packages/application/src/submission/queries.ts:304` (`fallbackResultForRow` → `accepted ? 100 : 0`)

`clampScore` must clamp to the problem total instead of 100 — thread the total in from the caller (the judge context already has the problem; pass `problemTotal`). `fallbackResultForRow` returns `score: accepted ? problemTotal : 0`.

**Step 1 — test** the adjustment path with a `problemTotal=200` problem: an accepted submission clamps at 200, a late-penalty rule scales off 200. **Step 2 — fail. Step 3 — thread `problemTotal`. Step 4 — pass. Step 5 — commit** `fix(scoring): clamp/fallback against problem total instead of 100`.

> Note: confirm where `clampScore`/`fallbackResultForRow` get the problem — they may need `computeProblemTotalScore` (sync) from the already-loaded judge context/testcase sets. Prefer the sync helper to avoid an extra query on the hot judge path.

---

## Phase 2 — Three domains snapshot the problem total

### Task 2.1: contest attach + `contestModeUsesPoints`

**Files:**
- Modify: `packages/application/src/contest/mutations.ts` (`resolveAndAttachContestProblems`, ~`:65-100`)
- Modify: `apps/web/src/lib/utils/contest-scoring.ts` (`contestModeUsesPoints`)

`resolveAndAttachContestProblems` must know the scoring mode (pass `scoringMode` in). Per problem:
- `weighted_count` → `points = entry.points` (teacher award, current behaviour).
- `point_sum` → `points = await getProblemTotalScore(tx, problem)` (snapshot; ignore any submitted `entry.points`).
- `problem_count` → `points` irrelevant; set `getProblemTotalScore(...)` (or leave entry.points) — scoring uses `1` regardless.

`contestModeUsesPoints(mode)` → **`mode === "weighted_count"` only** (point_sum no longer shows/uses a teacher input — its max comes from the problem). This makes `point-sum.ts`'s `sub.score >= prob.points` correct again (`prob.points` is now the true problem total, possibly 200).

**Steps:** extend `contest-schemas` / scoreboard unit tests so a `point_sum` contest whose problem total is `200` ranks a 200-scoring solve as full; a 120 partial contributes 120. TDD → commit `feat(contest): point_sum uses problem total as per-problem max`.

### Task 2.2: exam attach

**Files:** `packages/application/src/exam/mutations.ts:22-60` (`resolveAndAttachExamProblems`).

Drop `pointOverrides`; set `points = await getProblemTotalScore(tx, problem)`. Remove the `pointOverrides` param threading at `:137` and `:208`, and the `points_*` form parsing in `apps/web/src/routes/(app)/exams/[examId]/+page.server.ts:375-376` and exam create. Read paths (`exam/detail.ts` `resolveScoredState(score, ep.points)`, `problem-view.ts:142,244`, `submissions-matrix.ts`) keep reading `ep.points` (now = problem total). TDD around `exam/detail` AC state → commit `feat(exam): per-problem max = problem total, drop teacher points`.

### Task 2.3: assignment attach

**Files:** `packages/application/src/assignment/mutations.ts:96-123,179-188`.

Replace `pointsByProblem.get(id) ?? 100` with `await getProblemTotalScore(tx, problem)`. Drop the `pointsByProblem` plumbing and the form `points` source. Commit `feat(assignment): per-problem max = problem total, drop teacher points`.

### Task 2.4: verify consumers

No code change expected; add/confirm tests that `point-sum.ts:29/64` (`sub.score >= prob.points`) and `exam/detail.ts:88` (`score >= points`) behave correctly when `points` is the (possibly >100) problem total. Commit if any fix needed.

---

## Phase 3 — UI / display

### Task 3.1: remove teacher points inputs
- `apps/web/src/routes/(app)/courses/[courseId]/exams/new/+page.svelte` & exam settings — remove per-problem points field.
- Assignment create/settings — remove per-problem points field.
- `ExamProblemPicker.svelte` / assignment picker — drop points editing.
- Contest already handled by Task 2.1 (`contestModeUsesPoints` hides point_sum input; settings/new use it).

### Task 3.2: `/100` → `/{problem total}`
- `apps/web/src/lib/components/features/problem/left-panel/SubmissionHistoryPanel.svelte:211,283`
- `apps/web/src/routes/(app)/submissions/+page.svelte:143`
- `apps/web/src/routes/(app)/submissions/[submissionId]/+page.svelte:125`

Each needs the problem total available. Thread it from the loader (compute via `computeProblemTotalScore` on the already-loaded problem/testcaseSets) and render `{score}/{total}`.

### Task 3.3: `TestcaseZipUploader.svelte`
- `:102` auto-distribute: stop forcing `Math.round(100/count)`; let weights be authored freely.
- `:226,230,257,261` — drop the `totalPoints === 100` requirement and `{totalPoints}/100`; display the running total as the problem's full score.

Commit per file group. svelte-check after each: `pnpm --filter @nojv/web check`.

---

## Phase 4 — Seed + verification

### Task 4.1: seed script
**Files:** `packages/db/prisma/seeds/problems.ts` (weights, `:1326`), `demo-helpers.ts:196,228` (hardcoded 100), `contests.ts`, `courses.ts`.

- Give seeded problems meaningful subtask weights (at least one problem with total >100, e.g. `[80,120]=200`, to exercise the new range).
- `demo-helpers.ts` submission scores: stop hardcoding `100` / `(earnedWeight/totalWeight)*100`; use `earnedWeight` directly (= rawScoreSum) and `total = Σ weight`.
- Seed exams/assignments WITHOUT teacher points (attach derives total).

Run `pnpm db:push && pnpm db:seed` and spot-check a >100 problem end-to-end.

### Task 4.2: full verification
- `pnpm db:generate` (only if any schema touched) · `node scripts/check-migrations.mjs`
- `pnpm --filter @nojv/application typecheck`
- `pnpm --filter @nojv/web check` (run `paraglide:compile` first if messages changed)
- `pnpm lint`
- `pnpm test:unit`
- Manual: create a 200-point standard problem → submit partial → scoreboard/exam/assignment show partial vs /200 correctly.

---

## Risks / watch-list
- **Hot judge path:** prefer the sync `computeProblemTotalScore` (from already-loaded testcase sets) over an extra DB query in `scoring.ts`/`adjustments.ts`.
- **Snapshot staleness:** editing a problem's subtasks after it is attached does NOT update existing exam/assignment/contest `points`. Accepted by design. (A "refresh totals on rejudge" is a possible follow-up — YAGNI now.)
- **Advanced/`special_env`** stays at total 100; revisit if a custom-scored problem needs >100.
- **`score >= points` consumers** (`point-sum.ts`, `exam/detail.ts`) are now correct *because* `points` finally equals the real problem total — keep them, don't special-case.
