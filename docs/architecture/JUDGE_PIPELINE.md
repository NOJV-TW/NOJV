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

Per-testcase verdict. The strategy is chosen by `judgeConfig.type`. The crucial
fairness invariant for the non-standard strategies is **run/check separation**:
the container that runs untrusted student code never mounts the expected answers
or the validator source. Only the worker (or a second isolated container that
holds no student code) makes the AC/WA decision.

- **`standard`** — token-based comparison matching the DOMjudge/ICPC default output validator, in `packages/core/src/judge/compare.ts` (`compareStandard`). Both sides are split on any run of whitespace (spaces, tabs, **and newlines**), and the resulting token lists must match element-for-element. Whitespace amount and line structure are therefore always irrelevant (`"1 2"` = `"1  2"` = `"1\n2"`); this is hard-wired and not configurable. Two per-problem knobs, set by the problem author and stored in `judgeConfig.compare`, refine token matching:
  - `caseSensitive` (default `true`) — when `false`, tokens compare case-insensitively.
  - `floatTolerance` (default unset = exact) — when set to ε, two numeric tokens match if they are within absolute **or** relative error ε (the DOMjudge `float_tolerance` shorthand). Non-numeric tokens always compare exactly.

  The run container only emits each case's raw stdout/stderr/exit (`rawRuns`); the worker performs the comparison against the answer it holds, so `judgeConfig.compare` only needs to reach the worker. Anything token comparison cannot express (multiple valid answers, structural checks, etc.) must be implemented as a **checker**.

- **`checker`** — a teacher-provided **DOMjudge output validator** (`python` / `cpp`) that renders an **AC/WA verdict only** (no partial scoring). The run container produces `rawRuns` (no answer present); the worker then launches a **second isolated validator container** (`validator-executor.ts` → sandbox-runner `runValidate`) per clean case. The validator is invoked as `validator <input> <judge_answer> <feedback_dir>` with the team output on stdin and must **exit 42 (accept) or 43 (wrong)**; any other exit is treated as a validator/system error. Feedback travels through files in `feedback_dir`: `teammessage.txt` (shown to the student) and an optional `judgemessage.txt` (operator-only). Python TAs get a wrapper binding `judge_input` / `judge_answer` / `team_output` plus `accept()` / `wrong()` / `judge_log()` (`apps/sandbox-runner/assets/wrappers/python-validator.py`); C++ TAs implement the bare interface.
- **`interactive`** — a teacher-provided **DOMjudge interactor**, run as **two isolated containers** wired by a worker byte proxy (`interactive-executor.ts` → sandbox-runner `runInteractive`): the solution container runs student code with its stdio bridged to the interactor container, and the secret input/answer is mounted only into the interactor side. The interactor uses the same exit-42/43 + `feedback_dir` protocol as the validator, but its Python wrapper exposes live `read()` / `write()` instead of a fixed `team_output` blob (`apps/sandbox-runner/assets/wrappers/python-interactor-domjudge.py`).

On K8s, `checker` runs as a **two-Job pipeline**: the run Job's ConfigMap omits both the expected answer and the validator script; a second `judge-<sub>-validate` Job (separate ConfigMap, identical hardening, NO student source) compiles the validator and grades the captured team outputs against the answers, and the worker merges the outcomes via `mergeCheckerResults` (same merge as Docker). Per-case files reach the validate pod via flat keys (`case-{i}-{input,answer,team}.txt`) because ConfigMaps cannot hold nested directories. `interactive` **also runs on K8s** (`K8sExecutor.executeInteractive` → `runInteractiveCase`): one Job per testcase with two containers (solution + interactor) wired over a `socat` TCP bridge on port 7777, the secret input/answer mounted only into the interactor side. Only **tarball-source `advanced`** stays Docker-backend-only (the cluster cannot `docker load` a TA-supplied tarball); **registry-source `advanced`** runs as a K8s Job. See [backends](#sandbox-verdicts) and `k8s-executor.ts`.

### score

Subtask scoring is **all-or-nothing**: a `TestcaseSet` (subtask) earns its full `weight` only if **every** case in it is AC, otherwise 0. There is no per-subtask strategy column and no per-case partial credit — checkers/interactors render AC/WA only. This is uniform across practice, assignment, contest, and exam; contests adjust whole-**problem** aggregation (see [Architecture](./ARCHITECTURE.md)), not the subtask AC-all decision.

The final 0–100 score is `round((Σ rawScore / Σ weight) * 100)`, where each subtask's `rawScore` is `weight` (all cases AC) or `0`. This happens in `buildSubtaskResults()` and `mapResult()` inside `packages/application/src/submission/scoring.ts`. The raw score then goes through the post-judge adjustment step (see [Adjustment rules](#adjustment-rules)).

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
}
```

The TA image owns grading: `score` (0–100) is authoritative and overrides any
platform-side subtask weighting. Per-case detail flows through `testcases[]`;
there is no separate subtask channel (advanced problems have no platform
testcase sets). A `compile_error` verdict is surfaced as a compile failure
(verdict `compile_error`, score 0), matching standard mode.

A missing, unreadable, or malformed `result.json` collapses every testcase into `SE` via `advancedFallbackResult()` in the executor.

### Image source and resource limits

The TA provides an image via two columns on `Problem`:

- `advancedImageRef` — either a registry reference (`ghcr.io/org/judge:tag`) or a storage key pointing at a tarball
- `advancedImageSource` — `registry` or `tarball`

For `tarball` sources, the worker streams the tarball out of object storage and `docker load`s it on first use. The loaded ref is cached per storage key for the worker's lifetime.

Resource limits come from `Problem.timeLimitMs` / `Problem.memoryLimitMb` — the same fields and the same validation bounds as standard mode (there is no separate advanced limit field):

- `timeLimitMs` — 100 ms to 30 s, used as the container wall-clock budget (`advanced.totalTimeMs`)
- `memoryLimitMb` — 16 MB to 1024 MB cgroup limit (`advanced.memoryMb`)

Advanced Mode containers run with `--network none`, `--cap-drop ALL`, `--security-opt no-new-privileges`, a read-only rootfs (`--read-only`), and the same `--memory` / `--cpus` / `--pids-limit` bounds as standard mode. Writes are permitted only to two places: `/tmp` (a 64m `tmpfs`, for scratch the TA image needs) and `/workspace` (the host bind mount where the TA image writes `output/result.json`). The `/workspace` mount has no `tmpfs` size cap — the host disk is instead protected by a watchdog that polls the directory size every 2 s and force-removes the container if it exceeds **1 GiB**, failing the submission with a System Error (`advancedFallbackResult`). Unlike standard mode, advanced containers do **not** run with `--user`: the TA image is trusted and manages its own user. Any packages or test data the TA image needs must be baked into the image at build time — runtime fetches are not allowed. Advanced Mode also always skips the in-browser editor: students can only submit ZIP files (or a single source file that the platform wraps into `sourceFiles: [{ path, content }]`).

**Tarball-source advanced images require the Docker executor.** Docker-side dispatch lives in `apps/worker/src/services/advanced-mode-executor.ts` (`AdvancedModeExecutor.run`). The Kubernetes executor rejects **tarball-source** advanced requests (`K8sExecutor.executeAdvanced` short-circuits with an `SE` verdict — the learner sees a neutral _"Sandbox configuration error. Please contact your administrator."_ while the operator-facing reason is logged at `error` level), because the K8s path cannot `docker load` a TA-supplied tarball. **Registry-source** advanced images run on K8s as a Job (`buildAdvancedJobManifest`): init container materializes the submission, sidecar tails progress, and the TA grader container runs with `cap-drop ALL`, `allowPrivilegeEscalation: false`, read-only rootfs, and pod-level `seccompProfile: RuntimeDefault` — but without `runAsNonRoot`, matching the Docker path's trusted-TA design.

### Authoring an advanced judge image

TAs don't hand-write the boilerplate. The problem edit page (Advanced settings → Container contract) has a **Download starter project** button that streams a self-contained zip; the route is `GET /api/problems/advanced-scaffold` (auth-gated, zips `apps/web/src/lib/server/advanced-scaffold/files/` on the fly with JSZip). The scaffold contains:

- `Dockerfile` — `FROM python:3.12-slim`, bakes in `testcases/` + the grader code. There is no custom NOJV base image; the scaffold is fully self-contained (a published base image is a possible future ops follow-up).
- `nojv_grader.py` — a stdlib-only helper the TA does **not** edit. It loads `meta.json`, exposes `submission_files()` / `submission_path(rel)`, runs the student program via `run_submission(cmd, stdin, timeout)` (which copies the submission into a `/tmp` dir and runs it from there so the student's relative file I/O doesn't collide with grader files — this is **not** a security boundary, see below), and `write_result(score, verdict, feedback, testcases)` which validates/normalizes verdicts and writes `output/result.json` in the canonical shape.
- `grader.py` — the worked example the TA edits: read `testcases/case-*.json`, run each case, decide a per-case verdict, compute a 0–100 score, call `write_result(...)`.
- `testcases/case-*.json`, `README.md`.

Workflow: **download the scaffold → edit `grader.py` (and `testcases/`) → `docker build -t my-judge .` → upload** (either `docker save | gzip` a tarball and upload it as image source `tarball`, or push to a registry and paste the reference). Because the container runs with `--network none` and a read-only rootfs, every dependency and all test data must be baked into the image at build time — write only to `/workspace` and `/tmp`, and don't rely on the process exit code (only `result.json` is read). The canonical `result.json` verdicts are the long forms (`accepted`, `wrong_answer`, `time_limit_exceeded`, `memory_limit_exceeded`, `runtime_error`, `compile_error`) at the top level and the short codes (`AC`, `WA`, `TLE`, `MLE`, `RE`, `SE`) per testcase — `write_result` accepts either and normalizes.

**Protecting answers is the TA's responsibility.** Advanced mode runs the student's code _inside the TA image_, in the same container and as the same user as the grader. With `--cap-drop ALL` + `--read-only` and no `--user`, the grader cannot setuid-drop the submission to another UID and cannot hide or delete the baked-in files — so a malicious submission can read any world-readable path, including `/grader/testcases/`. The `run_submission` cwd-copy only isolates relative path collisions; it is **not** an isolation boundary. The safe pattern (used by the scaffold's `grader.py`) is to feed each case's input on **stdin** and compare the student's **stdout** to the expected answer inside the grader, so the student never needs the answer. Never hand the student a path to the expected output, and don't bake secrets at guessable readable paths when running untrusted code with broad filesystem access.

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

Late penalties and time bonuses are applied at the `Assessment` level via the `adjustmentRules` JSON column, **not per-problem and not on contests** — contests do not carry adjustment rules. The post-judge step in `mapResult()` calls `applyAdjustmentRules()` from `packages/application/src/submission/adjustments.ts` with the raw 0–100 score and the submission context (runtime, `submittedAt`, `dueAt`, `finalDay`).

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

## Source + verdict data flow

Submission sources and full verdict detail are stored in `@nojv/storage`
(S3-compatible), not Postgres. The `Submission` row carries only the
prefix / key references and a small JSON summary. The full flow:

1. **Create** — `submission/mutations.ts` opens a Prisma tx, validates +
   normalizes the per-file sources, writes the `Submission` row with
   `sourceStoragePrefix = submissions/<id>/sources/` and status
   `pending_upload`, and commits. **After** the tx commits, it calls
   `putSubmissionSources(storage(), id, sources)` to write one S3 object
   per file, then promotes the row to `queued`. If either the storage
   write or the `queued` update fails, partial source blobs are deleted
   best-effort and the row is flipped to `system_error` so the worker
   won't try to grade a row with missing or incomplete sources.
2. **Judge** — `executeSandbox` (in `apps/worker/src/activities/judge.ts`)
   loads sources via `submissionDomain.getSubmissionSources(id)` at the
   start of the activity rather than trusting the dispatch draft. Both
   fresh dispatches and rejudges see the same canonical bytes.
3. **Plagiarism** — `listSubmissionsForCheck` (in
   `packages/application/src/plagiarism/queries.ts`) reads per-file sources
   via the same helper and concatenates them in sorted-path order with
   `// === <path> ===\n` boundary markers before handing the merged
   blob to Dolos. Every Dolos-supported language treats `//` as a line
   comment, so the markers are dropped by the tokenizer.
4. **Complete** — `completeJudge` writes the full `SubmissionResult` to
   S3 at `submissions/<id>/verdict-detail.json` via `putVerdictDetail`
   first, then persists a small `verdictSummary` JSON + the
   `verdictDetailStorageKey` on the row. Writing the heavy blob first
   means a storage failure leaves the row in its prior state and
   Temporal's retry path can safely re-run `completeJudge` from the
   unchanged judge output.

| Lives in DB                                                                                    | Lives in S3                                                     |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `Submission` row (status, score, FKs, runtime / memory, timestamps)                            | Per-file sources: `submissions/<id>/sources/<relpath>`          |
| `Submission.sourceStoragePrefix` (pointer)                                                     | Full `SubmissionResult`: `submissions/<id>/verdict-detail.json` |
| `Submission.verdictSummary` (< 4 KB: case counters, subtask summary, truncated compiler error) |                                                                 |
| `Submission.verdictDetailStorageKey` (pointer, null until judge writes detail)                 |                                                                 |

`SubmissionStatus.pending_upload` is the non-terminal staging state between
the DB commit and durable source upload. `SubmissionStatus.system_error` is
the terminal verdict for storage-side and dispatch-side platform failures —
surfaced to the student as a non-graded fault so they can resubmit. See
`packages/db/prisma/schema/submission.prisma` and
`packages/storage/src/{keys,submission}.ts`.

## Activity / workflow boundary

The judge pipeline is driven by `submissionJudgeWorkflow` (`apps/worker/src/workflows/submission-judge.ts`). It is a thin orchestrator: every effectful step is a Temporal activity, and the workflow itself contains only control flow + the `mode` derivation needed to pick the right finalize path.

Timeouts and retry policy applied to the judge activities proxy:

| Activity proxy                              | `startToCloseTimeout` | `heartbeatTimeout` | `maximumAttempts` |
| ------------------------------------------- | --------------------- | ------------------ | ----------------- |
| `judge.*` (context / complete / rejudge)    | `5m`                  | —                  | 3                 |
| `judgeSandbox.executeSandbox` (sandbox run) | `10m`                 | `60s`              | 3                 |
| `lifecycle.*` short (stats, contest)        | `30s`                 | —                  | 3                 |
| `lifecycle.publishVerdict` (SSE/Redis)      | `10s`                 | —                  | 2                 |

`executeSandbox` runs on its own `judgeSandbox` proxy with a longer
`10m` ceiling and a `60s` heartbeat (the sandbox-runner heartbeats so a
hung container is detected before the start-to-close timeout); the rest
of the judge activities use the shorter `5m` `judge` proxy.

The standard-vs-advanced mode is decided by a small **inline expression in the workflow** (`apps/worker/src/workflows/submission-judge.ts`): `problemType === "special_env" && advanced !== null ? "advanced" : "standard"`. It is inlined rather than imported from `@nojv/application` because pulling the domain package into the workflow bundle would drag Prisma into the workflow sandbox, which Temporal forbids (workflow code must be deterministic and self-contained). The domain layer's own `deriveJudgeMode` (`packages/application/src/submission/queries.ts`, used by the judge activity) encodes the same rule, and its unit test exercises the condition to keep the two copies in sync.

## Reliability notes

- **Bounded stdout/stderr buffers** — both the worker (`apps/worker/src/services/bounded-buffer.ts`) and the sandbox runner (`apps/sandbox-runner/src/utils.ts` → `createBoundedBuffer`) cap captured output at 16 MB per stream. A runaway submission that prints infinite output will hit the cap, get a `[output truncated — exceeded N bytes]` marker, and continue to the per-case timeout instead of OOM-killing the runner or worker. The two buffers are intentionally kept as separate copies — pnpm workspace deps don't allow cross-app imports.
- **Sandbox temp-dir cleanup** — the runner wraps the main judging step in try/finally and calls `cleanupTempDir(workDir)` (from `apps/sandbox-runner/src/utils.ts`) on its `mkdtemp` work directory on exit, so a container restart between runs does not leak workspace state.
- **Outer container timeout** — Standard Mode uses `request.limits.timeoutMs * testcases.length + 30 s` as the docker-level kill timeout; Advanced Mode uses `advanced.totalTimeMs + 30 s`. The 30 s grace covers Docker startup/teardown overhead.

## Where the code lives

- Worker entrypoint — `apps/worker/src/index.ts`
- Standard Mode executor (Docker) — `apps/worker/src/services/standard-mode-executor.ts`
- Isolated checker validator executor (Docker) — `apps/worker/src/services/validator-executor.ts`
- Isolated interactive two-container executor (Docker) — `apps/worker/src/services/interactive-executor.ts`
- Advanced Mode executor (Docker only) — `apps/worker/src/services/advanced-mode-executor.ts`
- Kubernetes executor (Standard + checker via two-Job pipeline, interactive via per-case two-container Job, registry-source advanced via Job; rejects only tarball-source advanced) — `apps/worker/src/services/k8s-executor.ts`
- Sandbox plan / config builder — `apps/worker/src/services/sandbox-plan.ts`
- Worker bounded buffer — `apps/worker/src/services/bounded-buffer.ts`
- Sandbox runner (inside the container) — `apps/sandbox-runner/src/index.ts`
- Sandbox runner bounded buffer + memory poller — `apps/sandbox-runner/src/utils.ts`
- Compiler dispatch — `apps/sandbox-runner/src/compiler.ts`
- Standard token comparator (`compareStandard`) — `packages/core/src/judge/compare.ts`
- Per-case run helper (emits `rawRuns`, no in-container comparison) — `apps/sandbox-runner/src/judges/standard.ts`
- DOMjudge validator runner (in-container) — `apps/sandbox-runner/src/judges/validate.ts`
- DOMjudge interactor runner (in-container) — `apps/sandbox-runner/src/judges/interactive-isolated.ts`
- Per-case run-process helper / verdict classifier — `apps/sandbox-runner/src/judges/run-process.ts`
- DOMjudge Python wrappers — `apps/sandbox-runner/assets/wrappers/python-validator.py`, `python-interactor-domjudge.py`
- Temporal judge workflow — `apps/worker/src/workflows/submission-judge.ts`
- Temporal judge activity — `apps/worker/src/activities/judge.ts`
- Judge context builder — `packages/application/src/submission/judge-context.ts`
- Score aggregation (`buildSubtaskResults`, `mapResult`) — `packages/application/src/submission/scoring.ts`
- Score adjustments — `packages/application/src/submission/adjustments.ts`
- `judgeConfigSchema` — `packages/core/src/schemas/judge-config.ts`
- `advancedResultSchema` — `packages/core/src/schemas/advanced-mode.ts`
- `adjustmentRuleSchema` — `packages/core/src/schemas/assessment-adjustments.ts`
- `ProblemWorkspaceFile` table — `packages/db/prisma/schema/problem.prisma`

## Related docs

- [Architecture Overview](./ARCHITECTURE.md)
- [Database Schema](./DATABASE.md)
