# Submission Detail Page Redesign + Memory Reporting

**Date:** 2026-05-12
**Branch:** main (in-place)

## Three bundled changes

### 1. Back link respects submission context

`apps/web/src/routes/(app)/submissions/[submissionId]/+page.svelte` currently
hardcodes `href={`/problems/${submission.problem.id}`}`. The page already
loads `submission.context.kind`. Replace with context-aware target:

| context.kind | href                                               | label                       |
| ------------ | -------------------------------------------------- | --------------------------- |
| `assessment` | `/assignments/{assessmentId}/problems/{problemId}` | 回作業 / Back to assignment |
| `contest`    | `/contests/{contestId}/problems/{problemId}`       | 回比賽 / Back to contest    |
| `exam`       | `/exams/{examId}/problems/{problemId}`             | 回考試 / Back to exam       |
| `practice`   | `/problems/{problemId}`                            | 回題目 / Back to problem    |

Add paraglide keys: `submissionDetail_backToAssignment`,
`submissionDetail_backToContest`, `submissionDetail_backToExam`.

### 2. Memory usage pipeline

Sandbox-runner always runs in `node:24-alpine` (docker compose locally,
K8s pod in prod), so `/proc/<pid>/status` is always available.

**Tracking** — `apps/sandbox-runner/src/utils.ts` gains
`createMemoryPoller(pid)`:

1. Synchronous initial read so short-lived processes get one sample.
2. `setInterval(50ms)` reading `VmHWM` (peak resident KB).
3. `.stop()` clears interval and returns the max observed value.

**Propagation**:

```
run-process.ts / interactive.ts  →  RunProcessResult.memoryKb / TestcaseResult.memoryKb
core/sandbox.ts                  →  SandboxTestcaseResult.memoryKb (optional int)
core/schemas/submission.ts       →  testcaseResultItemSchema += memoryKb
                                     submissionResultSchema   += memoryKb (top-level peak)
domain/submission/scoring.ts     →  aggregate max(case.memoryKb) into mapped result
domain/submission/judge-context  →  completeJudge writes memoryKb to DB
db schema                        →  Submission.memoryKb already exists, no migration
```

Compile / pipeline error paths leave `memoryKb` undefined (no work was
measured).

### 3. Submission detail page redesign (LeetCode-style two-column)

```
back link
─────────────────────────────────────────────
left ~360px               │  right flex-1
─────────────────────────│ ──────────────────
verdict (color) + score  │  language pill ·
─────────────────────────│  86 行 · [copy] [↓]
4-cell metric grid       │ ──────────────────
context badge            │  CodeBlock
sample-only / staff      │  (h-screen minus
─────────────────────────│   header, internal
feedback                 │   scroll)
subtask list             │
case mini-grid           │
─────────────────────────│ ──────────────────
```

Responsive: stacks under `lg`.

**Case mini-grid rules**

- For `sampleOnly=true` (Run mode): cases are pills `#1 · 124 ms · 18 MB`
  with verdict color; clicking expands stdout (+ stderr if present)
  below the grid. Same as current behavior.
- For `sampleOnly=false` (Submit): pills are display-only — no stdout,
  no click — so problem testdata cannot leak through the submission
  page even when viewed by staff.

**Header bar on right pane**

- Language pill, line count, **Copy** (already in `CodeBlock`),
  **Download** (new): builds a Blob and clicks an `<a download>` link.

**No expected diff anywhere** — testcase secrecy.

## Out of scope

- Real-time SSE updates of memoryKb mid-judge (only show final).
- Memory profiling for advanced-mode (TA image owns its own grading).
- Per-subtask memory aggregation (just max across all cases is enough).
