# Judge Pipeline

The judge pipeline is the evaluation framework that compiles, executes, and scores submissions. It runs as a Temporal activity inside `apps/worker`. Problems come in two modes: **Standard Mode** for classic competitive-programming problems and **Advanced Mode** as an escape hatch for anything Standard Mode cannot express. The pipeline has no user-configurable stage graph — both modes run a fixed flow.

## Standard Mode pipeline

```
merge workspace files → compile → execute per testcase → check → score
```

### merge workspace files

Before the sandbox starts, the domain layer merges `ProblemWorkspaceFile` rows (editable + readonly + hidden) with the student's submitted files. Readonly and hidden workspace files always win over student paths, so a malicious client cannot overwrite them. Hidden files are never shown in the UI but are present on disk during compile/execute. The merge is implemented in `mergeSandboxSources()` inside `apps/worker/src/activities/judge.ts`.

The worker writes the merged source files plus testcase + config payloads to a tempdir that gets mounted into the sandbox. The sandbox runner then re-materialises any `sourceFiles` / `sourceFileMap` entries inside its private `workDir` before compile — see `materializeConfiguredSources()` in `apps/sandbox-runner/src/index.ts`. This second pass is what bridges the two layouts the runner has to accept:

- **Docker volume mount layout** — testcases live as `/submission/testcases/{index}/input.txt`, source files are addressed by relative path.
- **Flat ConfigMap layout (K8s)** — ConfigMaps don't support nested directories, so testcases become `testcase-{i}-input.txt` / `testcase-{i}-expected.txt`, and source files are stored under opaque keys `source-file-{n}` and mapped back to their real path via `sourceFileMap`.

`loadTestcases()` in the runner tries the directory layout first, falls back to the flat keys.

### compile

Language-specific build, run by the sandbox runner inside the isolated container:

| Language   | Build command                                   | Entry file  |
| ---------- | ----------------------------------------------- | ----------- |
| C          | `gcc -O2 -std=c17 -o main ...`                  | `main.c`    |
| C++        | `g++ -O2 -std=c++20 -o main ...`                | `main.cpp`  |
| Go         | `go build -o main .` (or single file)           | `main.go`   |
| Java       | `javac -d . ...` then `java -cp . Main`         | `Main.java` |
| JavaScript | none; `node main.mjs`                           | `main.mjs`  |
| Python     | none; `python3 main.py`                         | `main.py`   |
| Rust       | `rustc -O -o main main.rs`                      | `main.rs`   |
| TypeScript | none; `node --experimental-strip-types main.ts` | `main.ts`   |

Interpreted languages skip the compile step entirely — a syntax error only surfaces when `execute` tries to run the file.

### execute

One sandboxed process per testcase. Stdin comes from the testcase `input`, stdout/stderr/exit code/runtime/memory are captured. Per-case limits come from `Problem.judgeConfig.runtime`:

- `timeLimitMs` — 100 ms to 30 s, default 1000 ms
- `memoryLimitMb` — 16 MB to 1024 MB, default 256 MB
- `env` — extra environment variables injected into the process

All Standard Mode containers run with `--network none`, `--cap-drop ALL`, `--security-opt no-new-privileges`, a read-only rootfs, and bounded `tmpfs` mounts on `/tmp` (64m) and `/workspace` (128m).

### check

Per-testcase verdict. The strategy is chosen by `judgeConfig.type`:

- **`standard`** — stdout vs expected text comparison. `judgeConfig` has no `compare` block; the sandbox runner applies a single fixed canonical normalisation on both sides and tests exact equality. From `apps/sandbox-runner/src/judges/standard.ts`:
  1. `\r\n` → `\n`
  2. strip per-line trailing whitespace (spaces and tabs)
  3. strip trailing blank lines

  Float tolerance, case-insensitive matching, regex line filters, and any other custom comparison semantics must be implemented as a **checker**.

- **`checker`** — a teacher-provided script (`python` / `cpp`) receives `(input, expected, actual)` file paths. The script's **exit code** decides accepted vs not (0 = accepted, non-zero = rejected). On top of that, the protocol carries a 0–100 integer score and a feedback string — see `parseJudgeOutput()` in `apps/sandbox-runner/src/judges/run-process.ts`. If the score field is empty, it defaults to 100 on accept and 0 on reject; otherwise the parsed integer is clamped to `[0, 100]`. The score flows into the per-case `score` field that `PROPORTIONAL` subtask scoring averages over (see [score](#score)).
- **`interactive`** — a teacher-provided interactor communicates with the submission over stdin/stdout pipes and decides the verdict itself. Compiled the same way as a checker.

### score

Per-case results are aggregated into a 0–100 raw score using `TestcaseSet.scoringStrategy` (Prisma enum column on each subtask row, see `packages/db/prisma/schema/problem.prisma`). The domain layer reads `scoringStrategy` off each subtask into a `Record<testcaseSetId, strategy>` map in `packages/domain/src/submission/judge-context.ts`; there is no `scoring` block on `judgeConfig`. The strategies are:

- `ALL_OR_NOTHING` — set weight if every case in the subtask is AC, else 0. Default.
- `PROPORTIONAL` — `weight * (Σ caseScore) / (total * 100)`. Each `caseScore` is the per-case 0–100 score from the runner: 100 for AC and 0 for any other verdict under `standard`/`interactive`, or the checker's parsed score under `checker` (so partial credit on a single case flows through).
- `MINIMUM` — accepted by the schema but behaves identically to `ALL_OR_NOTHING` today. The runner has no separate signal to take a minimum over after the per-case score is already produced, so `buildSubtaskResults()` collapses it to the binary case.

The final 0–100 score is `round((Σ rawScore / Σ weight) * 100)`. This happens in `buildSubtaskResults()` and `mapResult()` inside `packages/domain/src/submission/scoring.ts`. The raw score then goes through the post-judge adjustment step (see [Adjustment rules](#adjustment-rules)).

## Advanced Mode pipeline

Advanced Mode is the escape hatch. The platform does **not** run compile/execute/check itself — instead it spawns a TA-provided Docker image and reads a structured result file. Use cases include problems that need custom toolchains, partial-credit grading, multi-stage pipelines, or anything else Standard Mode can't express.

### Container contract

The worker lays out a fixed `/workspace/` directory and mounts it into the TA image:

```
/workspace/submission/     student files (from ZIP or wrapped single source)
/workspace/meta.json       { submissionId, language, submissionFiles, resourceLimits }
/workspace/output/         TA image writes here
    result.json            required
    artifacts/             optional; currently ignored by the platform
```

`meta.json.submissionFiles` is the **actual list of relative paths the worker wrote into `submission/`** for this run (i.e. the post-merge layout), not a static declaration. TA images that need to discover the submission shape should iterate this array rather than scanning the filesystem. Built by `prepareWorkspace()` in `apps/worker/src/services/advanced-mode-executor.ts`.

Testcases are bundled inside the TA image itself — the platform no longer manages advanced-mode testcases. The TA image is expected to read `submission/` and `meta.json`, do whatever grading it wants against its baked-in test data, then write `/workspace/output/result.json`.

### `result.json` schema

Validated against `advancedResultSchema` in `packages/core/src/schemas/advanced-mode.ts`:

```jsonc
{
  "score": 0, // 0..100
  "verdict": "accepted", // accepted | wrong_answer | time_limit_exceeded
  // | memory_limit_exceeded | runtime_error | compile_error
  "feedback": "human-readable string",
  "testcases": [
    // optional, up to 1000
    { "index": 0, "verdict": "AC", "runtimeMs": 120, "feedback": "..." },
  ],
  "subtasks": [
    // optional, up to 100
    { "name": "sample", "score": 100, "passed": true },
  ],
}
```

A missing, unreadable, or malformed `result.json` collapses every testcase into `SE` via `advancedFallbackResult()` in the executor.

### Image source and resource limits

The TA provides an image via two columns on `Problem`:

- `advancedImageRef` — either a registry reference (`ghcr.io/org/judge:tag`) or a storage key pointing at a tarball
- `advancedImageSource` — `registry` or `tarball`

For `tarball` sources, the worker streams the tarball out of object storage and `docker load`s it on first use. The loaded ref is cached per storage key for the worker's lifetime.

Resource limits come from `Problem.timeLimitMs` / `Problem.memoryLimitMb`:

- `timeLimitMs` — 1 s to 300 s wall clock for the entire container
- `memoryLimitMb` — 16 MB to 1024 MB cgroup limit

Advanced Mode containers always run with `--network none`. Any packages or test data the TA image needs must be baked into the image at build time — runtime fetches are not allowed. Advanced Mode also always skips the in-browser editor: students can only submit ZIP files (or a single source file that the platform wraps into `sourceFiles: [{ path, content }]`).

**Only the Docker executor runs advanced containers.** Advanced dispatch lives in `apps/worker/src/services/advanced-mode-executor.ts` (`AdvancedModeExecutor.run`). The Kubernetes executor explicitly rejects advanced-mode requests: `K8sExecutor.execute` in `apps/worker/src/services/k8s-executor.ts` short-circuits with an `SE` verdict — the learner sees a neutral _"Sandbox configuration error. Please contact your administrator."_ while the operator-facing reason ("switch to Docker backend") is logged at `error` level. Operators running advanced-mode problems must run the Docker backend.

## Problem types

`Problem.type` drives the shape of the submission and how the judge pipeline assembles it:

- **`full_source`** — the student submits one complete source file. Content lands at `main.<ext>` in the sandbox workspace.
- **`multi_file`** — the teacher ships a scaffold (main + helpers); the student edits designated files in-browser. Every enabled language ships exactly one editable `main.<ext>`. Teachers achieve LeetCode-style "student implements a named function" by marking the function file as `visibility: "editable"` and the driver file as `visibility: "readonly"`.
- **`special_env`** — Advanced Mode. The TA-provided Docker image owns the entire judging loop; the student uploads a tarball / ZIP. See [Advanced Mode pipeline](#advanced-mode-pipeline).

## Workspace files

`ProblemWorkspaceFile` is the authoritative source for starter code, scaffolding, and hidden assets. Each row has a `visibility` that fully governs student edit access — there is no sub-file granularity:

| Visibility | Shown in UI      | Student can edit | Present in sandbox |
| ---------- | ---------------- | ---------------- | ------------------ |
| `editable` | yes              | yes (whole file) | yes                |
| `readonly` | yes (greyed out) | no               | yes                |
| `hidden`   | no               | no               | yes                |

Visibility is enforced on the server: `mergeSandboxSources()` rebuilds the sandbox workspace from `ProblemWorkspaceFile` plus the student's submitted contents for `visibility: "editable"` files only. A tampered client cannot inject replacements for `readonly` or `hidden` paths — the teacher version wins.

## Adjustment rules

Late penalties and time bonuses are applied at the `CourseAssessment` level via the `adjustmentRules` JSON column, **not per-problem and not on contests** — contests do not carry adjustment rules. The post-judge step in `mapResult()` calls `applyAdjustmentRules()` from `packages/domain/src/submission/adjustments.ts` with the raw 0–100 score and the submission context (runtime, `submittedAt`, `dueAt`, `finalDay`).

Rule types, defined in `packages/core/src/schemas/assessment-adjustments.ts`:

- `time_bonus` — linear bonus scaling from `maxBonusPercent` at 0 ms down to 0 at `baselineMs`. Skipped when `baselineMs ≤ 0` (avoids divide-by-zero NaN that would wipe the score).
- `flat_late_penalty` — one-shot multiplicative penalty `score *= (1 - penaltyPct/100)` if `submittedAt > anchor`. `startFrom` picks the anchor: `"due"` uses `dueAt`, `"final_day"` uses `finalDay`.
- `daily_late_penalty` — multiplicative per-day-late penalty `score *= max(0, 1 - daysLate * perDayPct/100)`. Days-late uses a `Math.floor` of the elapsed window, so the first 24 h past the anchor are penalty-free. Same `startFrom` choice as `flat_late_penalty`.
- `final_day_zero` — if `submittedAt > finalDay`, set score to 0. No-op (with a one-time warning log) when `finalDay` is missing.

Rules are applied in array order and the running score is clamped to `[0, 100]` after each step. Up to 10 rules per assessment.

Exponential late-decay (with `halfLifeHours`) and a per-submission memory penalty are intentionally **not** part of the schema — they used to be discussed in early drafts but were removed. Use `daily_late_penalty` for time-based decay; memory limits are enforced as hard MLE verdicts, not as score deductions.

## Sandbox verdicts

Per-case verdicts (`SandboxVerdict` in `packages/core/src/sandbox.ts`):

| Verdict | Meaning                        |
| ------- | ------------------------------ |
| AC      | Accepted                       |
| WA      | Wrong Answer                   |
| TLE     | Time Limit Exceeded            |
| MLE     | Memory Limit Exceeded          |
| RE      | Runtime Error (non-zero exit)  |
| SE      | System Error (sandbox failure) |

## Activity / workflow boundary

The judge pipeline is driven by `submissionJudgeWorkflow` (`apps/worker/src/workflows/submission-judge.ts`). It is a thin orchestrator: every effectful step is a Temporal activity, and the workflow itself contains only control flow + the `mode` derivation needed to pick the right finalize path.

Timeouts and retry policy applied to the judge activities proxy:

| Activity proxy                         | `startToCloseTimeout` | `maximumAttempts` |
| -------------------------------------- | --------------------- | ----------------- |
| `judge.*` (judging activities)         | `5m`                  | 3                 |
| `lifecycle.*` short (stats, contest)   | `30s`                 | 3                 |
| `lifecycle.publishVerdict` (SSE/Redis) | `10s`                 | 2                 |

`deriveJudgeMode` is deliberately **inlined into the workflow file** (`submission-judge.ts:48-53`) instead of imported from `@nojv/domain`. Pulling the domain package into the workflow bundle would drag Prisma into the workflow sandbox, which Temporal forbids (workflow code must be deterministic and self-contained). The inlined two-line check mirrors `submissionDomain.deriveJudgeMode`; a unit test on the domain helper exercises the same condition to keep the two copies in sync.

## Reliability notes

- **Bounded stdout/stderr buffers** — both the worker (`apps/worker/src/services/bounded-buffer.ts`) and the sandbox runner (`apps/sandbox-runner/src/utils.ts` → `createBoundedBuffer`) cap captured output at 16 MB per stream. A runaway submission that prints infinite output will hit the cap, get a `[output truncated — exceeded N bytes]` marker, and continue to the per-case timeout instead of OOM-killing the runner or worker. The two buffers are intentionally kept as separate copies — pnpm workspace deps don't allow cross-app imports.
- **Sandbox temp-dir cleanup** — the runner wraps the main judging step in try/finally and `rm -rf`s its `mkdtemp` work directory on exit (`apps/sandbox-runner/src/index.ts:333-338`), so a container restart between runs does not leak workspace state.
- **Outer container timeout** — Standard Mode uses `request.limits.timeoutMs * testcases.length + 30 s` as the docker-level kill timeout; Advanced Mode uses `advanced.totalTimeMs + 30 s`. The 30 s grace covers Docker startup/teardown overhead.

## Where the code lives

- Worker entrypoint — `apps/worker/src/index.ts`
- Standard Mode executor (Docker) — `apps/worker/src/services/standard-mode-executor.ts`
- Advanced Mode executor (Docker only) — `apps/worker/src/services/advanced-mode-executor.ts`
- Kubernetes executor (Standard only; rejects Advanced) — `apps/worker/src/services/k8s-executor.ts`
- Sandbox plan / config builder — `apps/worker/src/services/sandbox-plan.ts`
- Worker bounded buffer — `apps/worker/src/services/bounded-buffer.ts`
- Sandbox runner (inside the container) — `apps/sandbox-runner/src/index.ts`
- Sandbox runner bounded buffer + memory poller — `apps/sandbox-runner/src/utils.ts`
- Compiler dispatch — `apps/sandbox-runner/src/compiler.ts`
- Standard judge comparator — `apps/sandbox-runner/src/judges/standard.ts`
- Checker / interactive protocol parser — `apps/sandbox-runner/src/judges/run-process.ts` (`parseJudgeOutput`)
- Temporal judge workflow — `apps/worker/src/workflows/submission-judge.ts`
- Temporal judge activity — `apps/worker/src/activities/judge.ts`
- Judge context builder — `packages/domain/src/submission/judge-context.ts`
- Score aggregation (`buildSubtaskResults`, `mapResult`) — `packages/domain/src/submission/scoring.ts`
- Score adjustments — `packages/domain/src/submission/adjustments.ts`
- `judgeConfigSchema` — `packages/core/src/schemas/judge-config.ts`
- `advancedResultSchema` — `packages/core/src/schemas/advanced-mode.ts`
- `adjustmentRuleSchema` — `packages/core/src/schemas/assessment-adjustments.ts`
- `TestcaseSet.scoringStrategy` enum — `packages/db/prisma/schema/problem.prisma`
- `ProblemWorkspaceFile` table — `packages/db/prisma/schema/problem.prisma`

## Related docs

- [Architecture Overview](./ARCHITECTURE.md)
- [Database Schema](./DATABASE.md)
