# Judge Pipeline

The judge pipeline is the evaluation framework that compiles, executes, and scores submissions. It runs as a Temporal activity inside `apps/worker`. Problems come in two modes: **Standard Mode** for classic competitive-programming problems and **Advanced Mode** as an escape hatch for anything Standard Mode cannot express. The pipeline has no user-configurable stage graph — both modes run a fixed flow.

## Standard Mode pipeline

```
merge workspace files → compile → execute per testcase → check → score
```

### merge workspace files

Before the sandbox starts, the domain layer merges `ProblemWorkspaceFile` rows (editable + readonly + hidden) with the student's submitted files. Readonly and hidden workspace files always win over student paths, so a malicious client cannot overwrite them. Hidden files are never shown in the UI but are present on disk during compile/execute. The merge is implemented in `mergeSandboxSources()` inside `packages/temporal/src/activities/judge.ts`.

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

All Standard Mode containers run with `--network none`, `--cap-drop ALL`, `--security-opt no-new-privileges`, a read-only rootfs, and a `tmpfs` on `/tmp`.

### check

Per-testcase verdict. The strategy is chosen by `judgeConfig.type`:

- **`standard`** — stdout vs expected text comparison. The `compare` block on `judgeConfig` selects the mode:
  - `exact` (default)
  - `ignore_whitespace`
  - `ignore_case`
  - `float` (uses `floatAbsTol` / `floatRelTol`)
  - `regex_filter` (uses `ignoreLinePatterns` to strip matching lines before comparing)
  - _Note: the schema defines all five modes; the sandbox runner at `apps/sandbox-runner/src/judges/standard.ts` currently implements trimmed-exact comparison. The remaining modes land alongside new runner support._
- **`checker`** — a teacher-provided script (`bash` / `python` / `node` / `c` / `cpp`) receives `(input, expected, actual)` file paths and exits 0 for AC, non-zero for WA. Stderr becomes feedback.
- **`interactive`** — a teacher-provided interactor communicates with the submission over stdin/stdout pipes and decides the verdict itself. Compiled the same way as a checker.

### score

Per-case results are aggregated into a 0–100 raw score using `judgeConfig.scoring.subtaskStrategies`, a map keyed by `TestcaseSet.id`. The strategies are:

- `all_or_nothing` — set weight if every case AC, else 0. Default.
- `proportional` — `weight * (passed / total)`.
- `minimum` — accepted by the schema but behaves identically to `all_or_nothing` today. The runner has no partial-credit signal to take a minimum over, so `buildSubtaskResults()` collapses it to the binary case. Not implemented as a distinct strategy — no code path exists today.

The final 0–100 score is `round((Σ rawScore / Σ weight) * 100)`. This happens in `buildSubtaskResults()` and `mapResult()` inside `packages/temporal/src/activities/judge.ts`. The raw score then goes through the post-judge adjustment step (see [Adjustment rules](#adjustment-rules)).

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
    { "index": 0, "verdict": "AC", "runtimeMs": 120, "feedback": "..." }
  ],
  "subtasks": [
    // optional, up to 100
    { "name": "sample", "score": 100, "passed": true }
  ]
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
- `memoryLimitMb` — 16 MB to 4096 MB cgroup limit

Advanced Mode containers always run with `--network none`. Any packages or test data the TA image needs must be baked into the image at build time — runtime fetches are not allowed. Advanced Mode also always skips the in-browser editor: students can only submit ZIP files (or a single source file that the platform wraps into `sourceFiles: [{ path, content }]`).

Only the Docker executor currently runs advanced containers — `runAdvancedContainer()` lives in `apps/worker/src/services/docker-executor.ts`. The Kubernetes executor does not yet support Advanced Mode.

## Problem types

`Problem.type` drives the shape of the submission and how the judge pipeline assembles it:

- **`full_source`** — the student submits one complete source file. Content lands at `main.<ext>` in the sandbox workspace.
- **`function`** — the student implements a named function against a teacher-provided driver. Assembled from workspace files at judge time.
- **`multi_file`** — the teacher ships a scaffold (main + helpers); the student edits designated files in-browser. Every enabled language ships exactly one editable `main.<ext>`.
- **`special_env`** — Advanced Mode. The TA-provided Docker image owns the entire judging loop; the student uploads a tarball / ZIP. See [Advanced Mode pipeline](#advanced-mode-pipeline).

Editable regions on a `ProblemWorkspaceFile` replace the old driver-code / `// __USER_CODE__` insertion pattern. A workspace file may have `editableRegions: [[startLine, endLine], ...]`, and the student edits only those line ranges.

## Workspace files

`ProblemWorkspaceFile` is the authoritative source for starter code, scaffolding, and hidden assets. Each row has a `visibility`:

| Visibility | Shown in UI      | Student can edit                              | Present in sandbox |
| ---------- | ---------------- | --------------------------------------------- | ------------------ |
| `editable` | yes              | yes (optionally limited by `editableRegions`) | yes                |
| `readonly` | yes (greyed out) | no                                            | yes                |
| `hidden`   | no               | no                                            | yes                |

Editable regions are enforced in two places. The frontend uses Monaco read-only decorations, but that is only a UX hint. The server re-verifies by rebuilding the sandbox workspace from `ProblemWorkspaceFile` + the student's submitted editable-file contents in `mergeSandboxSources()`. A tampered client cannot inject replacements for readonly or hidden paths — the teacher version wins.

## Adjustment rules

Late penalties, time bonuses, and memory penalties are applied at the `CourseAssessment` or `Contest` level via the `adjustmentRules` JSON column, **not per-problem**. The post-judge step in `mapResult()` calls `applyAdjustmentRules()` from `packages/domain/src/submission/adjustments.ts` with the raw 0–100 score and the submission context (runtime, memory, submittedAt, dueAt).

Rule types, defined in `packages/core/src/schemas/assessment-adjustments.ts`:

- `late_penalty_fixed` — deduct `amount` per day or week late, up to `maxDeduction`
- `late_penalty_decay` — exponential decay with configurable `halfLifeHours`
- `time_bonus` — linear bonus scaling from 0 at `baselineMs` to `maxBonusPercent` at 0 ms
- `memory_penalty` — fixed deduction when peak memory exceeds `thresholdMb`

Rules are applied in array order and the running score is clamped to `[0, 100]` after each step. Up to 10 rules per assessment/contest.

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

## Where the code lives

- Worker entrypoint — `apps/worker/src/index.ts`
- Docker executor (Standard + Advanced) — `apps/worker/src/services/docker-executor.ts`
- Kubernetes executor (Standard only) — `apps/worker/src/services/k8s-executor.ts`
- Sandbox plan / config builder — `apps/worker/src/services/sandbox-plan.ts`
- Sandbox runner (inside the container) — `apps/sandbox-runner/src/index.ts`
- Compiler dispatch — `apps/sandbox-runner/src/compiler.ts`
- Standard judge comparator — `apps/sandbox-runner/src/judges/standard.ts`
- Temporal judge activity — `packages/temporal/src/activities/judge.ts`
- Judge context builder — `packages/domain/src/submission/judge-context.ts`
- Score adjustments — `packages/domain/src/submission/adjustments.ts`
- `judgeConfigSchema` — `packages/core/src/schemas/judge-config.ts`
- `advancedResultSchema` — `packages/core/src/schemas/advanced-mode.ts`
- `adjustmentRuleSchema` — `packages/core/src/schemas/assessment-adjustments.ts`
- `subtaskScoringStrategySchema` — `packages/core/src/pipeline.ts`
- `ProblemWorkspaceFile` table — `packages/db/prisma/schema.prisma`

## Related docs

- [Architecture Overview](../ARCHITECTURE.md)
- [Temporal Workflows](TEMPORAL.md)
- [Database Schema](DATABASE.md)
