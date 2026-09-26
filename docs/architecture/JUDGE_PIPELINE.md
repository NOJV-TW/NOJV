# Judge Pipeline

How submissions are compiled, executed, checked and scored. Temporal workflows in
`apps/worker` orchestrate durable, snapshot-pinned executions; student code runs
only in hardened Docker (local) or Kubernetes (production) sandboxes. Problems use
fixed **Standard Mode** (`standard` / `checker` / `interactive`, JDG-01) or
**Advanced Mode** (`special_env` run/grade images, JDG-16). Decisions live in
[judge decisions](../decisions/judge.md); operator steps in the
[judge queue runbook](../runbooks/judge-queue.md).

## Key code

| Area                                              | Path                                                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Durable workflow, cleanup workflow                | `apps/worker/src/workflows/durable-judge.ts`                                                                      |
| Stage / journal activities                        | `apps/worker/src/activities/judge-execution.ts`                                                                   |
| Pinned request, workspace merge, time factor      | `apps/worker/src/activities/judge-request.ts`, `judge.ts` (`mergeSandboxSources`)                                 |
| Worker bootstrap, slots, queues                   | `apps/worker/src/worker-app.ts`, `apps/worker/src/env.ts`                                                         |
| Docker backend                                    | `apps/worker/src/sandbox/docker/` (`args.ts` is the hardened-args builder, JDG-19)                                |
| Kubernetes backend                                | `apps/worker/src/sandbox/kubernetes/` (standard, interactive, advanced executors; manifests; watch; cleanup)      |
| Shared plan, payloads, log parsing, result merge  | `apps/worker/src/sandbox/shared/`                                                                                 |
| In-container runner and phases                    | `apps/sandbox-runner/src/` (`index.ts`, `judges/`, `payload-materializer.ts`)                                     |
| Execution helper                                  | `apps/sandbox-runner/native/nojv-exec.c`                                                                          |
| DOMjudge Python wrappers                          | `apps/sandbox-runner/assets/wrappers/`                                                                            |
| Execution creation, state, stages, rejudge        | `packages/application/src/submission/judge-execution.ts`, `rejudge-control.ts`                                    |
| Dispatch gate, reconciliation                     | `packages/application/src/submission/judge-recovery.ts`, `sweep.ts`                                               |
| Scoring, adjustments                              | `packages/application/src/submission/scoring.ts`, `adjustments.ts`                                                |
| Priority key, stage size, states, limits          | `packages/core/src/judge-execution.ts`, `packages/core/src/sandbox.ts`                                            |
| Comparator, time factor, toolchain manifest       | `packages/core/src/judge/compare.ts`, `judge/time-factor.ts`, `judge-environment.json`                            |
| Schemas (`judgeConfig`, advanced, output, adjust) | `packages/core/src/schemas/judge-config.ts`, `advanced-mode.ts`, `sandbox-output.ts`, `assessment-adjustments.ts` |
| Dispatch API, task queues                         | `packages/temporal/src/dispatch.ts`, `task-queues.ts`                                                             |
| Browser Test                                      | `apps/web/src/lib/services/browser-local-run.ts`                                                                  |

## Durable execution and recovery

### Acceptance

- Submission creation writes a `pending_upload` row, uploads source objects and an
  immutable judge snapshot under guarded unique keys, then commits the source
  manifest, `JudgeExecution` and a `submission.execution.dispatch` outbox row in one
  transaction (PRB-15). A failed upload is never acknowledged.
- The snapshot is a checksummed object holding sources, testcases, workspace files,
  judge programs, limits, adjustment rules and the sandbox image; problem generation
  is checked at acceptance. Production images are digest-pinned in Helm; local
  unpinned builds are not reproducible.
- Workflow ID is `judge-execution-{executionId}-{recoveryEpoch}`; start uses
  `REJECT_DUPLICATE`, so repeated dispatch is idempotent.

### Workflow

`durableJudgeWorkflow` carries only the execution ID. Each iteration:

1. Read state; if a lease is held, run `reconcileJudgeStage`. Unconfirmed cleanup
   sets `blocked` / `cleanup_required` and retries after 60 s.
2. Run `executeJudgeStage` for the next stage. Standard, checker and interactive
   split testcases into stages of `JUDGE_STAGE_CASES` (20); Advanced is one atomic
   stage (run, grade and service share one PVC and lifetime).
3. Each stage result is written to an immutable object
   (`judge-executions/{id}/stages/{n}/{leaseToken}.json`); PostgreSQL commits the
   pointer and next state together. A compile error is terminal.
4. After the last stage: `finalizing` → `completePinnedJudge` commits the verdict,
   then score effects and notifications, then `finishJudgeExecution`.

The workflow continues as new after 100 iterations or when Temporal suggests it.
Checkpoints and pinned content survive continue-as-new.

### Stage activity

- Claims a database lease, heartbeats Temporal and renews the lease every 15 s; lost
  ownership aborts the sandbox.
- Any `pipelineError`, SE case or SE raw run fails the stage with
  `JudgeResultSystemError` (the stage is not saved), so platform failures retry
  instead of becoming final verdicts (JDG-09).
- A heartbeat timeout before the first heartbeat requeues without counting a failure.

### States and failure handling

`JudgeExecution.state`: `queued`, `waiting_capacity`, `running`, `recovering`,
`blocked`, `finalizing`, `completed`, `cancelled`.

| Failure                                                                                  | State              | Next attempt                                     |
| ---------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------ |
| `SandboxBackpressureError` (quota/capacity)                                              | `waiting_capacity` | 30 s, no failure count                           |
| Other failure, fewer than 3 consecutive                                                  | `recovering`       | `min(5 min, 5 s × 2^n)` (`judgeRecoveryDelayMs`) |
| `SandboxCleanupError`, `SandboxAdmissionError`, `SandboxInfeasibleError`, or 3rd failure | `blocked`          | 15 min                                           |
| Failure while `finalizing`                                                               | stays `finalizing` | same delays                                      |

- `recovering` and `blocked` move the execution to the `background` queue class and
  show the submission as `system_error` while it retries; nothing exhausts into a
  final student verdict.
- Namespace hard quotas reject only demonstrably infeasible requests; scoped quotas,
  admission defaults and node capacity are left to actual admission.
- Retries reuse the pinned snapshot and image; they never substitute a version.

### Reconciliation

`reconcileJudgeExecutions` runs every minute from the submission sweeper
(`submission-pending-sweeper`) and at platform-worker start, up to 100 rows each:

- Completed/cancelled executions still holding an expired lease get
  `judgeCleanupWorkflow` (ID `judge-cleanup-{leaseToken}`, on `judge`), which retries
  `reconcileJudgeStage` every 60 s until cleanup is confirmed.
- Due executions with no workflow are re-enqueued for dispatch.
- A running workflow with a workflow task stuck > 10 min or no activity progress
  > 70 min is terminated and retried.
- Otherwise a closed workflow gets a new recovery epoch (new workflow ID,
  `background` class) and a new dispatch outbox row.

Recovery is generation-guarded; at most one active judge workflow per submission
(JDG-11). Only the platform worker runs recovery.

### Rejudge

- A teacher rejudge pins the latest effective problem version at commit, creates a
  new generation, cancels older non-terminal executions and writes a
  `SubmissionRejudgeLog` (JDG-10, PRB-18). Rejudges run in the `background` class.
- The previous valid result stays visible until the new one commits.
- A rejudge is refused while another execution of the submission is `finalizing`;
  cancellation cannot interrupt committed-result finalization.
- Historical SE rows without a snapshot are blocked with
  `original_version_unavailable`; only a teacher rejudge selects a new version.
- The sweeper marks a stale in-flight submission that has no pinned execution as
  SE; only a teacher rejudge selects a new version for it.

### Tracking

Submission reads include the execution view (state, generation, problem generation,
reason code, last progress, next retry). The shared browser tracker keeps polling
through recoverable SE and rejudges that retain an old result; batch progress comes
from captured children, and one cancelled child does not stop tracking the others.

### Activity / workflow boundary

Effectful work stays in activities; payloads are execution IDs and object pointers,
never full source, testcase or output bodies.

| Activity proxy                              | Queue                            | Start-to-close | Heartbeat | Attempts |
| ------------------------------------------- | -------------------------------- | -------------- | --------- | -------- |
| Journal (status, state, commit, finish)     | `judge-state`                    | 2 min          | —         | 3        |
| Sandbox stage / `reconcileJudgeStage`       | `judge` (with workflow priority) | 70 min         | 60 s      | 1        |
| Scoreboard notification                     | `judge-state`                    | 2 min          | —         | 3        |
| Contest/exam score updates, verdict publish | `platform`                       | 2 min          | —         | 3        |

Kubernetes Job deadlines are capped at 30 min; the 70-min budget also covers
admission, transfer and cleanup.

A batch or single rejudge commits its pinned executions and a `prepared: true`
`submission.rejudge.dispatch` row in one transaction; the row's handler only marks
it succeeded, and progress and cancellation read the executions. Rows without
`prepared: true` predate durable execution: they report their cached terminal
progress and are otherwise not found.

## Queue priority and capacity

Ordering is Temporal task-queue priority and fairness, not an in-house scheduler
(JDG-12).

| Execution                                    | `priorityKey` |
| -------------------------------------------- | ------------- |
| Exam submission                              | 1             |
| Contest submission                           | 2             |
| Practice/assignment submission               | 3             |
| Submission with `recoveryEpoch > 0`          | 4             |
| Rejudge (execution carries an `operationId`) | 5             |

- `fairnessKey` is the student ID. Stage activities pass the workflow priority
  explicitly.
- Priority follows the execution's origin, not `queueClass`. `recovering`/`blocked`
  states and new recovery epochs set `queueClass = background` only to order the
  student's own executions in the per-student gate below.
- Per-student gate (`executeJudgeExecutionDispatch`): an execution starts only when
  the student has no earlier unfinished execution of the same class and, for
  background work, no unfinished foreground execution. Finishing or cancelling
  enqueues the student's next foreground and background executions. Queued work is a
  database row, not a live workflow.
- Only `executeJudgeStage` and `reconcileJudgeStage` run on `judge`, so one judge
  slot is one sandbox Job. Bookkeeping runs on `judge-state` (activity-only worker in
  the same process, 16 fixed slots) so verdicts never queue behind Jobs.
- `judge`, `judge-state` and `platform` must each use one task-queue partition, and
  fairness needs `matching.enableFairness` (see runbook).
- Judge and platform workers cache at most 32 workflows and run at most 8 workflow
  tasks concurrently.

Capacity:

- Slots are `WORKER_CONCURRENCY`, or a resource-based range from
  `WORKER_MIN_CONCURRENCY` to `WORKER_CONCURRENCY` (JDG-13); see
  [runbook capacity](../runbooks/judge-queue.md#capacity).
- A stage's run container requests and is limited to `K8S_RUN_PARALLELISM` CPUs, so
  slots × `K8S_RUN_PARALLELISM` cases run at once; the chart refuses values above the
  sandbox `ResourceQuota` CPU.
- A saturated worker interleaves submissions at stage granularity: a queued exam
  submission waits behind a bulk rejudge for at most one stage.
- There is no cross-submission compilation cache.

## Standard Mode pipeline

```
merge workspace files → run stage (compile once, execute cases) → judge stage (compare / validate) → score
```

### Reference solution validation

An author's private reference submission (`isReferenceSolution`) uses the ordinary
judge but is excluded from history and statistics. An accepted one becomes the
problem's verification pointer, recording `Problem.storageGeneration`; any later
change to testcases, workspace files, judge configuration, limits or type
invalidates it (PRB-09).

### Workspace merge and payloads

- `mergeSandboxSources()` rebuilds the workspace from `ProblemWorkspaceFile` rows plus
  the student's contents for `editable` files only; `readonly` and `hidden` files
  always win (see [Workspace files](#problem-types-and-workspace-files)).
- Run payload: `testcase-{i}-input.txt` (inputs only) and opaque
  `source-file-{n}` keys; `sourceFileMap` restores original paths inside the runner's
  private work directory. The runner reads only the requested testcase.
- Judge payload: `case-{i}-answer.txt`, plus `case-{i}-input.txt` for checkers,
  and the validator source.
- Kubernetes payloads are sharded binary ConfigMaps with a SHA-256 manifest,
  materialized into an emptyDir before student code starts (JDG-21).

### Compile

Commands and pinned versions come from `packages/core/src/judge-environment.json`
(JDG-14; version table in
[Deployment](../operations/DEPLOYMENT.md#standard-judge-toolchain)).

| Language   | Entry file            | Compiled                                                |
| ---------- | --------------------- | ------------------------------------------------------- |
| C / C++    | `main.c` / `main.cpp` | `gcc -std=c17` / `g++ -std=c++20`, `-O2`                |
| Go         | `main.go`             | `go build`                                              |
| Java       | `Main.java`           | `javac`; runs `java Main`                               |
| JavaScript | `main.mjs`            | no                                                      |
| Python     | `main.py`             | no                                                      |
| Rust       | `main.rs`             | `rustc -O`                                              |
| TypeScript | `main.ts`             | `tsc --strict --noEmitOnError`; runs emitted JS on Node |

JavaScript and Python syntax errors surface at execution. TypeScript type errors are
compile errors. Compilation has a 90 s timeout, at least 512 MiB memory and a
256 MiB scratch `/tmp`, so it does not consume the solution's budget.

### Stage topology

A standard or checker stage is one Kubernetes Job with one Pod:

| Container    | Phase         | Mounts                                                            |
| ------------ | ------------- | ----------------------------------------------------------------- |
| `run` (init) | `run-stage`   | run payload, `/submission`, `/artifact`, `/outputs`, scratch      |
| `judge`      | `judge-stage` | judge payload, `/outputs` read-only, its own artifact and scratch |

- `run` compiles once into `/artifact`, then executes the stage's cases, up to the
  stage parallelism at a time, each in a fresh scratch directory, writing stdout and
  its SHA-256 to `/outputs`.
- `judge` starts only after `run` exits, so no student process is alive while answers
  exist in the Pod (JDG-05). It verifies each output hash (mismatch is WA) before
  comparing or validating.
- Stage parallelism is `min(K8S_RUN_PARALLELISM, floor((SANDBOX_MAX_MEMORY_MB − 128) /
caseMemory))`, at least 1; the run container memory is
  `max(parallelism × caseMemory + 128 MiB, 512 MiB)`, capped at the ceiling. The
  judge container gets compiler resources.
- Container logs carry the compile result, per-case reports with at most 64 KiB of
  displayed output, and judge verdicts, never full outputs.
- Job completion is observed through resource-versioned Job/Pod watches with
  snapshot resync. Only regular-container running/terminated evidence starts the
  execution deadline; a Pod `startTime` does not.
- Job deadline: 90 s compile + `2 × timeLimit` per case (+ validator compile and
  `2 × max(30 s, timeLimit)` per case for checkers) + 60 s, clamped to 120 s–30 min.

Docker runs the same two phases as two containers (`nojv-judge-r-*`, `nojv-judge-j-*`)
with host directories in place of emptyDirs and run parallelism 1. Run outer
timeout: `min(90 s + (2 × timeLimit + 5 s) × cases + 30 s, 540 s)`; judge container
300 s.

### Execute and measurement

Per-case limits come from `judgeConfig.runtime`:

- `timeLimitMs` — 100 ms to 30 s, default 1000
- `memoryLimitMb` — 16 to 1024, default 256
- `env` — extra environment variables

Effective time limit is `ceil(timeLimitMs × LANGUAGE_TIME_FACTOR[language])` (c/cpp/rust
1, go 1.5, java/javascript/typescript 2, python 3), applied once in the pinned
request builder; every downstream ceiling derives from it. Not applied to Advanced
Mode; no memory factor (JDG-07).

Every solution and validator process runs through `nojv-exec` (JDG-06):

- own session; `RLIMIT_CPU` = `ceil(limit s) + 1`; `RLIMIT_CORE = 0`
- killed at the wall budget (`2 × limit`) or when summed RSS of its processes,
  polled every 10 ms, exceeds the memory limit (stops the program before gVisor
  OOM-kills the whole container)
- child subreaper: no descendant outlives the run; the runner (PID 1) kills orphans
- reports `wait4` CPU time and peak RSS for every reaped process, so students are
  charged only for their own processes; non-dumpable
- a program that kills its helper is RE; under gVisor CPU time has 10 ms ticks
- tests set `NOJV_EXEC_PATH` to a locally compiled helper

Memory (JDG-08):

- MLE is post-hoc: `max(ru_maxrss, polled summed RSS) > memoryLimitMb` reclassifies
  an otherwise AC/WA run.
- The container hard limit is `resolveContainerMemoryMb`:
  `max(limit, min(limit + SANDBOX_MEMORY_HEADROOM_MB, SANDBOX_MAX_MEMORY_MB))`
  (defaults 64 and 1536), so 1024 MB resolves to 1088 MB. `SANDBOX_MEMORY_MB` /
  `K8S_MEMORY_LIMIT` is the fallback when no limit is declared.
- Docker sets `--memory-swap` equal to `--memory`.

Container hardening flags are in [Security](../operations/SECURITY.md#sandbox-hardening-seccomp-posture);
all Standard containers use `--network none`.

### Check

Chosen by `judgeConfig.type`. Answers and validator/interactor code never reach the
container running student code (JDG-05).

- **`standard`** — `compareStandard` (JDG-02): tokens split on ASCII whitespace
  (space, tab, CR, LF, VT, FF) must match one-for-one; whitespace amount and line
  structure never matter. `judgeConfig.compare`:
  - `caseSensitive` (default `true`, stricter than DOMjudge) — `false` folds ASCII
    letters only.
  - `floatTolerance` (default exact) — numeric tokens match within absolute **or**
    relative ε; decimal and hex floats use 40-digit decimal arithmetic; NaN matches
    NaN; infinities must share sign. Bit-identical rounding at native long-double
    boundaries is not promised.
- **`checker`** — DOMjudge output validator in `python` or `cpp`, AC/WA only
  (JDG-03). Invoked as `validator <input> <judge_answer> <feedback_dir>` with team
  output on stdin; exit 42 = AC, 43 = WA, anything else, timeout (`max(30 s,
limit)`), crash or output overflow = SE. `feedback_dir/teammessage.txt` reaches the
  student, `judgemessage.txt` is staff-only. The Python wrapper binds `judge_input`,
  `judge_answer`, `team_output`, `accept()`, `wrong()`, `judge_log()`; C++ uses the
  bare interface. Results must cover the requested indices exactly once before
  `mergeCheckerResults` builds the outcome map.
- **`interactive`** — DOMjudge interactor with the same exit/feedback protocol; the
  Python wrapper exposes live `read()` / `write()`.
  - Kubernetes: one Job per stage, one Pod with `solution` and `interactor`
    containers bridged by `socat` on `127.0.0.1:7777`; only the interactor mounts
    secret input/answers.
  - Docker: two containers whose stdio the worker pipes together.
  - Both sides compile once, exchange a ready frame, then run cases in order over one
    channel of `DATA`/`EOF` frames tagged with the case index. A case starts only after
    both programs of the previous case exit. Compilation and peer startup do not use
    the student time limit. A malformed frame or mid-stage channel close marks the
    current and remaining cases WA.
  - Per-case wall budget is `max(2 × limit, max(30 s, limit))`.
  - Runner reports use typed stderr markers; after readiness stdout carries only the
    framed conversation. Student compile failure is CE; interactor compile failure is
    a platform error with diagnostics visible to staff only.

Anything token comparison cannot express needs a checker; no compare modes.

### Score

- Subtasks are all-or-nothing in every context (JDG-04): a `TestcaseSet` earns its
  `weight` only if every case is AC. No partial credit, no per-subtask strategy, no
  early exit.
- `buildSubtaskResults()` / `mapResult()` validate expected count and distinct
  zero-based indices and match cases by index; missing, duplicate or out-of-range
  cases cannot produce Accepted.
- Any SE case makes the submission `system_error` (score 0, no attempt consumed).
  `mapResult` shares one 256,000-byte diagnostic budget across cases.
- The raw score then goes through [adjustment rules](#adjustment-rules). Contest
  aggregation is per problem (ASM-08); activity point allocation is applied outside
  judging (ASM-16, [assignments](../features/assignments.md#activity-allocation-and-official-scores)).

### Output limits and contracts

- Combined stdout/stderr per run is capped at 16 MiB (`MAX_EXECUTION_OUTPUT_BYTES`);
  exceeding it is RE for a solution and SE for a validator. The runner then emits only
  the first 64 KiB of each stream.
- Worker (`sandbox/shared/bounded-buffer.ts`) and runner (`createBoundedBuffer`) each
  cap captured streams at 16 MiB with a `[output truncated — exceeded N bytes]`
  marker. They are separate copies because apps cannot import each other.
- Each case result is one JSON line in the container log. containerd splits lines
  over 16 KiB and kubelet may interleave the runner's `nojvResourceUsage` stderr line;
  the worker log parser reassembles split lines byte-exactly, skipping standalone JSON
  and `[sandbox-runner]` lines.
- Worker and runner share Zod output schemas from `@nojv/core`; parse failures keep
  field paths. A missing checker/interactor language or malformed persisted config is
  an integrity failure, never a fallback.
- Official testcases missing an expected answer are SE; an explicit empty answer
  still compares.
- Submission source is preserved byte for byte; all-whitespace source is rejected
  without trimming valid programs. Stdin bytes are never altered (no appended LF).

## Browser Test

Standard Mode **Test** runs sample and custom cases in the browser via pinned
`@wasm-oj/browser` (JDG-15). It never creates a submission or touches Temporal;
**Submit** always uses the server pipeline, including checker, interactive and
Advanced.

- Uses `judgeConfig.runtime` limits and env (problem limits otherwise) with the
  language time factor; the problem time limit sets Forge's logical-time budget.
  Instruction or logical-time exhaustion is TLE.
- Shares the comparator and workspace merge rules with the worker; only editable
  files count toward the submission size limit, public teacher files are added
  locally, hidden file contents never reach the browser.
- Custom cases without an expected answer report execution success only.
- Shares the 16 MiB combined output limit.
- Private checkers/interactors and custom images need browser-compatible public
  assets; until those exist the controller reports the missing capability.
- Results are previews: WASI toolchains, logical time, linear memory and filesystem
  caps differ from native judging; passing samples implies nothing about hidden tests.

## Advanced Mode pipeline

`special_env` problems run a TA **run** image and a separate TA **grade** image
(JDG-16). The platform owns topology and hardening; the TA owns image content.
Students submit a ZIP (or one source file wrapped into `sourceFiles`); the
in-browser editor is skipped.

### Run/grade phases

1. **run** — run container (student code, uid 10001, no answers) plus at most one
   service sidecar. Reads baked-in testcase inputs, writes per-case outputs and status
   markers to `/workspace/output/`.
2. **capture** — after run exits, `/workspace/output/` is copied through the
   capture gate; the worker derives `runStatus`.
3. **teardown** — run container, sidecar and per-submission networks are removed.
4. **grade** — grade container (answers baked in, uid 10001, no egress, no student
   code) reads the captured output read-only and writes `result.json`.

All resources are per-submission, removed in `finally` and swept as orphans.

### Container contract

Run container:

```
/workspace/submission/   student files (ZIP contents or wrapped single source)
/workspace/meta.json     { submissionId, language, submissionFiles, resourceLimits }
/workspace/output/       run harness output (binary OK)
(testcase inputs baked into the run image)
```

- `submissionFiles` is the post-merge list of relative paths actually written;
  harnesses iterate it instead of scanning.
- The run harness compiles and runs the student; it reports compile failure via
  `/output`, and the grade harness maps it to `compile_error`.

Grade container:

```
/workspace/run-output/         captured run /output, read-only (binary OK)
/workspace/meta.json           { submissionId, language, runStatus }
/workspace/output/result.json  grade harness writes here
(answers baked into the grade image)
```

- `runStatus` is `{ state: "exited" | "timed_out" | "oom_killed", exitCode }` for the
  whole run container; per-case TLE/RE/WA is conveyed through `/output`. The network
  mode is not exposed.
- Files are copied byte for byte and never decoded; decoding and comparison happen in
  the grade harness.
- Built by `prepareRunWorkspace()` / `prepareGradeWorkspace()`.

### `result.json`

Validated by `advancedResultSchema` and `validateAdvancedResultForMaxScore`:

```jsonc
{
  "score": 0, // 0..advancedConfig.maxScore (default 100, max 100000)
  "verdict": "accepted", // accepted | wrong_answer | time_limit_exceeded
  // | memory_limit_exceeded | runtime_error | compile_error (short codes accepted)
  "feedback": "optional, up to 10000 chars",
  "testcases": [
    // optional, up to 1000
    { "index": 0, "verdict": "AC", "runtimeMs": 120, "feedback": "up to 4000 chars" },
  ],
}
```

`accepted` requires `score == maxScore` and vice versa. The grade harness owns the
score; Advanced problems have no platform testcase sets. `compile_error` is shown as a
compile failure with score 0.

### Verdict ownership and system errors

- The worker always grades after a run that did not fail infrastructurally, including
  an empty `/output`.
- SE (`sandboxSystemError`, a single SE case) only for: run/grade spawn failure, capture size cap
  or run watchdog exceeded, grade timeout, missing or invalid `result.json`, and on
  Kubernetes a non-zero `transfer` sidecar exit. Like any SE stage result, this
  enters durable recovery.
- `ImagePullBackOff` ends the attempt with `SandboxImagePullError`; a single
  `ErrImagePull` keeps waiting. Eviction, `Shutdown`, `NodeShutdown`, `NodeLost`,
  `Preempted` and `DisruptionTarget` are retryable infrastructure failures in a fresh
  sandbox (JDG-20). OOM, TLE and program errors stay verdicts.

### `advancedConfig`

`Problem.advancedConfig` (`advancedConfigSchema`):

```jsonc
{
  "run": { "imageRef": "...", "imageSource": "registry" },
  "grade": { "imageRef": "...", "imageSource": "registry" },
  "network": {
    "mode": "service", // "none" (default) | "service"
    "service": { "imageRef": "...", "imageSource": "registry" }, // iff mode = "service"
  },
  "maxScore": 100,
}
```

- `imageRef` is digest-pinned and restricted to `ADVANCED_IMAGE_ALLOWED_REGISTRIES`
  by the web layer (PRB-12). `service` is required iff `mode = "service"`.
- `Problem.advancedRequiredPaths` separately governs the required ZIP layout
  (PRB-13).
- `Submission.advancedConfigSnapshot` is an audit record of the config that graded
  the submission, overwritten on each judge and never read back. The execution
  snapshot pins the config; a rejudge pins the latest.

### Network modes

The run container is single-homed with no internet route (JDG-17).

| Mode             | Run reaches                   | Extra container |
| ---------------- | ----------------------------- | --------------- |
| `none` (default) | nothing                       | —               |
| `service`        | isolated TA service on `8888` | service         |

- `NOJV_SERVICE_HOST` is `service:8888` on Docker and `<ClusterIP>:8888` on
  Kubernetes (no DNS). The service listens on `PORT` and prints `NOJV_SERVICE_READY`
  before the run starts. It has no egress.
- **Docker** (`advanced-mode-executor.ts`, `network.ts`, `service-container.ts`):
  `none` uses `--network none`; `service` creates a per-submission internal-only
  network shared by run and service. Grade uses `--network none`.
- **Kubernetes** (`advanced-executor.ts`, `advanced.ts`, `advanced-network.ts`):
  - Run and grade are separate Jobs. Output crosses via a per-submission
    `ReadWriteOnce` PVC; a native `transfer` sidecar in the run Pod runs the same
    capture gate on TERM. The grade Pod is pinned to the run Pod's node
    (`spec.nodeName`) and mounts the PVC read-only.
  - The service runs in a separate Pod behind a per-submission ClusterIP Service
    because containers in one Pod share a netns.
  - The chart's `deny-all-sandbox` policy (`templates/sandbox-policy.yaml`) selects
    every sandbox Pod; per-submission policies only add allowances. A service-mode run
    Pod is labeled `nojv.egress=<id>` and gets `buildRunEgressPolicy` (egress only to
    the service Pod, `ingress: []`).
    The grade Pod is labeled `nojv.egress=<id>-grade` and gets `buildGradeEgressPolicy`
    (`egress: []`) in every mode. The service Pod gets ingress from the run Pod only
    and no egress.
  - Worker RBAC for pods, services, networkpolicies and PVCs is in
    `templates/worker-rbac.yaml`.
  - NetworkPolicy enforcement by the CNI is a hard dependency; the worker's startup
    probe refuses to start without it.

### Hardening

| Property            | run                       | grade       | service               |
| ------------------- | ------------------------- | ----------- | --------------------- |
| `--cap-drop ALL`    | yes                       | yes         | yes                   |
| `no-new-privileges` | yes                       | yes         | yes                   |
| read-only rootfs    | yes                       | yes         | yes                   |
| user                | 10001                     | 10001       | 10001                 |
| network             | its service only, or none | none        | ingress from run only |
| holds answers       | never                     | yes (baked) | never                 |

Writes are allowed only to `/tmp` and `/workspace`. A watchdog kills the run when its
workspace exceeds 1 GiB or 100,000 files.

### Capture gate

`safeCopyTree` walks the dead run container's `/output`, `lstat`ing every entry first
(SEC-14):

- skips every symlink (never copied or dereferenced), so `output/x → /answers/...`
  cannot reach the grade side
- skips FIFOs, sockets and device nodes without opening them
- copies regular files as raw bytes; over 100,000 files or 1 GiB throws
  `SafeCopyLimitError` (SE)

It runs host-side in platform code (unit-tested, no TOCTOU against a live container);
the Kubernetes `transfer` sidecar embeds a byte-identical copy, locked by a parity
test.

### Authoring images

- The problem editor's **Download starter templates** calls
  `GET /api/problems/advanced-scaffold` (source:
  `apps/web/src/lib/server/advanced-scaffold/`) for `run`, `grade` and `service`
  templates plus a README; the public guide is `/guides/advanced-mode`.
- run: `runner.py` + Dockerfile baking inputs. grade: `grader.py` + the stdlib-only
  `nojv_grader.py` helper (normalizes long or short verdicts, `write_result`) +
  Dockerfile baking answers. service: minimal HTTP service on `PORT` (8888).
- Workflow: edit harnesses → `docker build` → push to an allowlisted registry → paste
  digest-pinned refs. Worked examples: `infra/docker/demo-advanced-run`,
  `infra/docker/demo-advanced-grade`.

## Problem types and workspace files

`Problem.type` (PRB-01):

- `full_source` — one complete source at the entry file.
- `multi_file` — teacher scaffold; each enabled language has exactly one editable
  `main.<ext>`. Function-style problems mark the function file `editable` and the
  driver `readonly`.
- `special_env` — [Advanced Mode](#advanced-mode-pipeline).

`ProblemWorkspaceFile.visibility` is whole-file and enforced by
`mergeSandboxSources()`:

| Visibility | Shown in UI | Student edits | In sandbox |
| ---------- | ----------- | ------------- | ---------- |
| `editable` | yes         | yes           | yes        |
| `readonly` | greyed out  | no            | yes        |
| `hidden`   | no          | no            | yes        |

## Adjustment rules

`applyAdjustmentRules()` runs inside `mapResult()` on assignments and exams with the
raw score, problem maximum, runtime, receipt time and on-time deadline `dueAt`.
Contests have no adjustment rules. Policy is ASM-12.

- `time_bonus` (assignments): `+ max(0, 1 − runtime / baselineMs) × maxBonusPercent`;
  skipped when `baselineMs <= 0`.
- `flat_late_penalty`: if `submittedAt > dueAt`, `× (1 − penaltyPct / 100)` once.
- `daily_late_penalty`: if `submittedAt > dueAt`,
  `× max(0, 1 − ceil((submittedAt − dueAt) / 86_400_000) × perDayPct / 100)`; 24 h is
  one day, 24 h + 1 ms is two.
- After each rule the score is rounded and clamped to `[0, max]`.
- At most one late penalty per activity (plus runtime bonuses on assignments); a
  penalty requires `dueAt` strictly before the final deadline, and a penalty without
  `dueAt` is an error.
- `Assessment.closesAt` / `Exam.endsAt` reject submissions at or after the deadline;
  closing never zeroes earned scores. Official per-problem grades use the best
  adjusted score; practice submissions never count.

## Sandbox verdicts

`sandboxVerdicts` in `packages/core/src/schemas/sandbox-output.ts`: `AC`, `WA`,
`TLE`, `MLE`, `RE` (non-zero exit or signal), `SE` (platform failure). Compile
failure is reported separately as CE.

## Result storage

- Full verdict detail goes to an immutable `judge-runs` object; PostgreSQL commits its
  checksummed pointer with the summary and score.
- Stage checkpoints and snapshots are verified object pointers. Write guards clean
  uncommitted objects after the reader grace interval.
- Snapshot retention must cover every recoverable execution; a lost snapshot blocks
  recovery instead of falling back to current problem data.
- Plagiarism reads canonical source files from the source manifest.

## Cleanup and observability

- Attempt cleanup removes the run's Jobs, Pods, ConfigMaps, PVC and temporary result
  objects with UID preconditions and foreground deletion. A timeout or ownership
  change raises `cleanup_pending` and keeps the lease (JDG-22). Kubernetes API
  disappearance alone does not prove runtime termination.
- The runner cleans its `mkdtemp` work directory in `finally`.
- `judge_phase_duration_seconds` phases: `queue`, `admission`, `schedule`, `startup`
  (includes image pull), `prepare`, `execute`, `checker`, `collect`, `cleanup`,
  `end_to_end`; labels are phase, mode, language and result only. Also
  `judge_cpu_seconds`, `judge_cpu_throttled_seconds`, `judge_memory_peak_bytes`
  (runner cgroup telemetry), `judge_cleanup_pending_total` and
  `judge_wall_clock_timeouts_total`. Missing lifecycle or resource data is not zero.

## Related docs

- [Architecture Overview](./ARCHITECTURE.md)
- [Database Schema](./DATABASE.md)
- [Reliability Invariants](../operations/RELIABILITY.md)
- [Security Requirements](../operations/SECURITY.md)
