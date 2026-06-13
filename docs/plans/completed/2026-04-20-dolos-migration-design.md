# Dolos Migration — Replace MOSS with AST-based Plagiarism Detection

**Date:** 2026-04-20
**Scope:** Replace the MOSS-based plagiarism activity with Dolos.
Keep the existing domain module / API / UI / status lifecycle; swap
out just the "go fetch submissions, compute similarity, write pairs"
body of the Temporal activity. Introduce a narrow `SimilarityPair`
shape change, update the Docker image inventory, and plan the
handling of any historical MOSS-era data.
**Status:** Design draft, pending approval.

---

## Background

Current plagiarism detection goes through
`packages/temporal/src/activities/plagiarism.ts` →
`submitToMoss(userId, lang, files)` over a raw TCP socket to
`moss.stanford.edu:7690`. Two real problems with this path:

1. **Language coverage is wrong for our stack.** MOSS has no Go or
   Rust parser — the current code maps both into MOSS's `c` bucket as
   a best-effort approximation, and maps `typescript` into
   `javascript`. The `cpp` case is handled correctly (separate `cc`
   bucket), which is what caught the spec drift in the test backfill.
   AST fidelity is lost for exactly the modern CP languages.
2. **Third-party dependency with no SLA.** moss.stanford.edu is
   Alex Aiken's Stanford-hosted service (dating from 1994), has no
   uptime guarantees, can rate-limit us, and ties every detection run
   to an egress connection from the worker. If Stanford pulls the
   plug we lose the feature entirely with no in-house fallback.

A secondary but real cost is that the activity currently persists
placeholder similarity scores (`similarity1: 0, similarity2: 0`)
because we never implemented the MOSS HTML scraper that extracts
actual per-pair percentages. The UI buckets by similarity but every
pair reports Low until that scraper lands. Migrating stack is a
better investment than writing the scraper.

## Goals

- **Drop `moss.stanford.edu` egress entirely.** All detection runs
  locally in the worker container — no third-party network dependency.
- **Every `SupportedLanguage` gets a native parser.** c / cpp / go /
  java / javascript / python / rust / typescript all have first-class
  tree-sitter grammars in the Dolos distribution.
- **Real similarity scores on day one.** Dolos's similarity is
  computed and returned directly — no HTML scraping required.
- **Preserve the existing domain / API / UI surface.** Clients see
  the same endpoints, same status lifecycle, same tab UI. The
  internal `SimilarityPair` shape changes; the external contract does
  not.

## Non-goals

- Building a self-hosted MOSS replacement from scratch — use Dolos.
- Supporting languages beyond the current `SupportedLanguage` set.
  Dolos can do C# / PHP / Scala / Bash, but exposing those is a
  separate initiative.
- Adding a plagiarism-review UI (flag as false positive, mark
  reviewed, etc.) — out of scope, a separate spec.
- Migrating historical MOSS pair data into Dolos-shape pairs. Prior
  reports are snapshots; re-running after migration produces fresh
  results against the current submission set.

---

## Chosen tool: Dolos

- **License:** MIT — zero friction with NOJV's MIT license.
- **Runtime:** Node.js; publishes `@dodona/dolos-lib` (core) and
  `@dodona/dolos` (CLI).
- **Language engine:** tree-sitter grammars bundled as native N-API
  addons. Real AST parsing per language, not shared tokenizer
  buckets.
- **Output:** structured JSON including per-pair similarity, longest
  common fragment, and a fingerprint overlap score.
- **No network egress:** runs entirely in-process.

See `docs/plans/active/2026-04-20-dolos-migration-plan.md` (to be
written after this design is approved) for task-level execution.

---

## Integration surface

Three plausible integration shapes; picking the simplest that works:

| Shape                       | Pro                                                                    | Con                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `@dodona/dolos-lib` in-proc | No subprocess overhead; shares Node.js memory and logger with Temporal | Native addon's N-API grammar binaries must match the worker's libc (glibc on `node:24-bookworm-slim`) and architecture |
| `dolos` CLI subprocess      | Same-process isolation; easy to upgrade independently                  | Needs a temp directory dance for input files; extra fork/exec latency                                                  |
| Separate long-lived service | Scales independently; can run on its own image                         | More infra to run (new service, health check, HA); overkill for our scale                                              |

**Decision: use `@dodona/dolos-lib` as a direct npm dependency of
`packages/temporal` (or `@nojv/plagiarism`, see below).** Reasoning:

- We already run on `node:24-bookworm-slim` for the worker — glibc
  matches Dolos's prebuilds.
- In-process removes the temp-file shuffling the CLI approach needs.
- Our scale is small (tens of batches per day, most with < 200
  submissions). No need for a separate service.
- Dolos's own CLI is a thin wrapper over `@dodona/dolos-lib` — we're
  just shortcutting the wrapping.

If Dolos's native addons cause problems (prebuild not available for a
given Node ABI, or libc-version mismatch in a future base image),
fallback is the CLI-subprocess path. That's a one-day rewrite, not a
blocker.

## Plagiarism domain package boundary

Today plagiarism is split between:

- `packages/application/src/plagiarism/` — query + persist methods,
  target resolution, error classes.
- `packages/temporal/src/activities/plagiarism.ts` — MOSS socket +
  dedup + grouping + pair construction.

The activity file currently **contains real business logic** (dedup
per `(user, problem)`, language bucketing, pair generation, failure
marking). The new version will contain equivalent logic wrapped
around a Dolos call.

**Decision: keep the split as-is.** Moving the activity's logic into
`@nojv/application` would force `@nojv/application` to depend on
`@dodona/dolos-lib` + its native addons, pulling Dolos into every
consumer including the web image (which would never execute it).
Leave the Dolos-specific code in the Temporal activity, where it
already lives.

---

## Data shape change — `SimilarityPair`

Current shape (`packages/application/src/plagiarism/types.ts:1-9`):

```ts
export interface SimilarityPair {
  linesMatched: number;
  mossUrl: string;
  problemId: string;
  similarity1: number; // similarity from user1's perspective
  similarity2: number; // similarity from user2's perspective
  userId1: string;
  userId2: string;
}
```

Proposed shape:

```ts
export interface SimilarityPair {
  problemId: string;
  userId1: string;
  userId2: string;
  similarity: number; // 0..100, Dolos-native metric
  longestFragment: number; // longest common AST fragment (tokens)
  totalOverlap: number; // total overlapping tokens
}
```

Removed fields:

- `mossUrl` — the old per-pair deep-link URL. Dolos reports have
  no equivalent: everything is in-memory. UI can still deep-link to a
  side-by-side source-code view via the existing
  `?source=true&userId&problemId` API.
- `similarity1` / `similarity2` — MOSS reported two numbers because
  MOSS normalizes against each submission's size. Dolos reports one
  symmetric similarity. Replacing two fields with one simplifies the
  UI bucketing logic.
- `linesMatched` → `longestFragment` + `totalOverlap`. Dolos reports
  AST tokens matched rather than source lines; two numbers capture
  "one long chunk copied" vs "many small chunks spread across the
  file".

### Report-level fields

The inlined `plagiarism*` columns on `Exam` / `CourseAssessment`:

- `plagiarismMossReportUrl` → **rename to
  `plagiarismReportUrl`** via Prisma migration. Value becomes `null`
  for Dolos runs (no external report URL) or a relative link to an
  in-product report view if we later ship one. Old MOSS URLs in the
  column should stay as-is for reports that completed pre-migration;
  the UI will render them read-only.

Migration strategy: single schema migration renames the column and
maps the field name in the repository. No data transformation — the
column content (strings or nulls) is copyright- and privacy-safe as
historical records.

---

## Activity rewrite

```ts
// packages/temporal/src/activities/plagiarism.ts (sketch)

import { Dolos } from "@dodona/dolos-lib";
import { plagiarismDomain } from "@nojv/application";

export async function runPlagiarismCheck(
  targetId: string,
  targetType: "courseAssessment" | "exam",
): Promise<void> {
  const target = { type: targetType, id: targetId };
  await plagiarismDomain.updateReportStatus(target, "running");

  try {
    const submissions = await plagiarismDomain.fetchSubmissionsForCheck(target);
    if (submissions.length === 0) {
      await plagiarismDomain.saveResults(target, { pairs: [] }, null);
      return;
    }

    // Best-score per (user, problem) — unchanged dedup step.
    const best = dedupeByBestScore(submissions);

    // Group by (problem, language). Dolos needs a consistent language
    // per analysis run, so each group is one Dolos invocation.
    const groups = groupByProblemAndLanguage(best);

    const allPairs: SimilarityPair[] = [];
    for (const group of groups.values()) {
      if (group.subs.length < 2) continue;

      const dolos = new Dolos({ language: group.language });
      const report = await dolos.analyze(
        group.subs.map((s) => ({
          path: `${s.userId}.${extensionForLang(group.language)}`,
          content: s.sourceCode,
        })),
      );

      for (const pair of report.pairs) {
        allPairs.push({
          problemId: group.problemId,
          userId1: pair.leftFile.path.replace(/\..+$/, ""),
          userId2: pair.rightFile.path.replace(/\..+$/, ""),
          similarity: pair.similarity * 100,
          longestFragment: pair.longestFragment,
          totalOverlap: pair.totalOverlapTokens,
        });
      }
    }

    await plagiarismDomain.saveResults(target, { pairs: allPairs }, null);
  } catch (err) {
    await plagiarismDomain.markReportFailed(target).catch(() => {});
    throw err;
  }
}
```

Unchanged behaviours:

- Status lifecycle (`pending → running → completed | failed`).
- Best-score dedup per `(user, problem)`.
- Per-problem-per-language grouping.
- Skip groups with fewer than 2 survivors.
- Unmapped-language skip (Dolos's supported set is a superset of
  ours, so this branch becomes dead code we can remove — but keep a
  guard for robustness).
- Failure path calls `markReportFailed` and rethrows.

### Tests

The existing unit tests in
`tests/unit/temporal/plagiarism-activity.test.ts` stay relevant with
minor shape updates:

- `pairs c + go + rust together under the shared MOSS 'c' bucket` →
  rewrite as three separate groups (Dolos parses each natively),
  assert each group produces its own pairs independently.
- `keeps cpp in the 'cc' bucket separate from the c-family bucket` →
  delete (no longer meaningful — c and cpp just have separate
  parsers).
- Keep all dedup, single-submission-skip, failure-path tests.
- Add: "reports Dolos similarity as 0-100 integer" test.

---

## Docker image impact

`infra/docker/worker.Dockerfile` uses `node:24-bookworm-slim`.
`@dodona/dolos-lib` publishes prebuilt N-API grammar binaries for
common targets:

- Linux x86_64 glibc (our primary deploy target — Cloud Run / GKE).
- Linux arm64 glibc (Cloud Run ARM; Apple Silicon dev via Docker).
- macOS / Windows for dev.

Expected image size delta: **~15–25 MB** for the prebuilt grammars

- Dolos core. Not negligible but comfortably inside existing
  container budgets. If prebuilds are missing for the target arch,
  Dolos falls back to building from source, which would require
  `build-essential` + `python3` in the builder stage. Out of caution:

* Confirm prebuilds exist for our target platforms before removing
  the MOSS code path.
* If not, add `build-essential python3` to the builder stage only
  (not the final runtime image).

No change needed to `web.Dockerfile` — the web app never executes
plagiarism detection.

---

## UI changes

`AssignmentPlagiarismReport.svelte` currently buckets pairs by
`similarity` at `< 50`, `50–70`, `≥ 70`. Dolos similarity has the
same 0–100 semantics, so the bucketing threshold carries over. The
single-metric change means:

- Table column "Similarity (A / B)" → "Similarity" (one column).
- The per-pair link currently goes to `mossUrl` (external). Change
  to an in-product deep-link to the existing source-code GET endpoint
  (`/api/plagiarism/[assessmentId]?source=true&userId=X&problemId=Y`).
  Staff already has access to this route; it renders the two sources
  side-by-side in a dialog.

The empty-state, pending-state, running-state, and failed-state UI
are untouched.

---

## Rollout strategy

**One-shot replacement, no feature flag.** Reasons:

- The feature has one producer (the Temporal activity) and one
  consumer (the staff UI). No fan-out of callers to migrate.
- The data shape change is narrow (4 fields in one interface + 1
  column rename). Running both code paths during a transition would
  require maintaining two shapes in the Json column simultaneously —
  more complexity than the switch deserves.
- MOSS is not user-visible to students; a brief maintenance window
  for staff is tolerable.

Cutover:

1. Merge schema migration (column rename) and deploy.
2. Deploy the new activity + UI together.
3. Any in-flight MOSS runs at deploy time will finish writing in the
   old format; the UI's rename-safe reader handles both.
4. Historical MOSS pair data remains in the DB untouched. Re-running
   any old report against the current submission set produces a fresh
   Dolos-format `results`.

Fallback: if Dolos blows up post-deploy (prebuild arch mismatch,
native-addon crash, etc.), revert the worker image to the prior tag.
The column rename is forward-compatible with the old code once its
field alias lands — keep a short-lived repo-layer alias during the
first release.

---

## Open questions

- **Do we keep `SimilarityPair.problemId`?** Yes. The shape is
  flattened (no parent grouping object) specifically so every pair
  can be rendered with its problem context without a second lookup.
- **Should Dolos output be cached per (submission-set hash)?** Not
  now. Re-running a report is an explicit staff action; caching
  adds invalidation complexity for a workflow that's designed to be
  re-run after testcase / submission changes.
- **Cross-language pairing (e.g. student A in Python and student B
  in Java)?** Not supported by Dolos, and not meaningful in this
  course-work context anyway. Same as MOSS.
- **Self-similarity baseline (a student's own two submissions across
  rejudges)?** Pre-MOSS dedup already keeps only the best-score
  submission per `(user, problem)`, so this doesn't arise.

---

## Related docs

- `docs/specs/plagiarism.md` — acceptance spec (needs minor update
  to reflect new data shape + Dolos language coverage after
  implementation).
- `packages/temporal/src/activities/plagiarism.ts` — activity file
  being rewritten.
- `packages/application/src/plagiarism/types.ts` —
  `SimilarityPair` + `PlagiarismResults` interfaces.
- `infra/docker/worker.Dockerfile` — consumer of the new native
  addon.
