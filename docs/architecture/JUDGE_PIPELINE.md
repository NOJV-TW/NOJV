# Judge Pipeline

The judge pipeline compiles, executes, and scores submissions. Temporal workflows orchestrate activities in `apps/worker`; student programs execute only inside isolated Docker or Kubernetes sandbox containers. Problems come in two modes: **Standard Mode** for classic competitive-programming problems and **Advanced Mode** for custom run/grade images. Both follow fixed flows rather than a user-configurable stage graph.

Kubernetes capacity admission is implemented behind
`worker.sandbox.capacityAdmission.enabled`, which defaults to `false`. The
compile-once stages and coordinator described below are the enabled path;
the existing Job-wave executor remains the default. Their availability in code
does not establish production performance or a completed rollout. The 100-person
benchmark and gVisor integration release evidence are still pending; see the
[capacity operations runbook](../runbooks/judge-capacity.md).

## Browser-local sample/custom tests

For Standard Mode problems, the editor's **Test** action can run sample and
user-defined custom cases in the browser through `@wasm-oj/browser`. This path
does not create a submission, does not enter Temporal, and is not trusted for
official scoring. The editor prewarms one shared browser engine and shows only
`初始化中...` while it is preparing and `測試中...` while a local run is active.

Browser and server runs preserve exact stdin bytes, including empty input,
missing final LF, CRLF, whitespace, and trailing blank lines. Samples are problem
data: their input must reflect the intended format, including any final newline.
Neither execution path silently repairs a program's EOF handling by appending data.
Custom sample runs without an expected answer report execution success. The server
checker API follows the same absent-answer rule. An explicit empty answer still enables comparison;
missing expected answers in official testcases remain a system error.

Browser runs honor `judgeConfig.runtime` limits and environment variables, using
problem limits when no runtime override exists. Standard browser Test stays local
for all supported languages, including Python input without a final newline.
The Test controller never dispatches a server workflow. Custom images and private
checker/interactor programs require public browser-compatible Test assets; until
those are available, the controller reports the missing capability. The browser
never receives hidden file contents. Browser source assembly and the worker share
workspace merge rules; only editable student files count toward the submission
body limit, and public teacher files are added locally afterward.

Browser and native standard runs share a 16 MiB combined stdout/stderr execution
limit. Exceeding it stops the solution with RE; validator overflow is SE. This
limit is independent of the smaller result-display limits. Docker protocol capture
allows JSON escaping of both compiler diagnostic streams plus envelope metadata.
Native standard runs use a 2× effective time limit as their wall-clock ceiling.
Browser Test retains Forge's deterministic clock, normalized instruction budget
and default emergency wall deadline; the problem time limit sets its logical-time
budget. Standard/checker
prepare containers use a separate 256 MiB compiler scratch directory and at least
512 MiB memory, so cold compilation does not consume the solution's smaller
scratch or memory budget. Checker execution mounts its prepared artifact read-only
and retains the original runtime memory limit and 64 MiB temporary scratch.
Kubernetes Job deadlines include the compiler timeout, full per-case wall budget
and scheduling overhead. Validator outer deadlines also include the 30-second
per-case timeout floor, while retaining the existing total Docker/K8s deadline caps.
Interactive peers still compile and execute within their respective runtime
containers; they do not receive the separate compiler resource allowance.
Runtime limits remain problem-specific. Submission source is
preserved byte-for-byte; validation rejects all-whitespace source without trimming
valid programs. Server request deadlines cover dispatch and polling, and an early
verdict notification wakes polling once without creating a busy loop.

Browser results remain a preview: WASI toolchains, deterministic logical time,
linear memory, filesystem caps and platform APIs differ from native compilation
and CPU/cgroup accounting. The editor displays Forge logical time, not elapsed
host time. Instruction or logical-time exhaustion remains TLE; NOJV does not
raise instruction limits to force a native-looking verdict.
Identical inputs and comparison settings do not guarantee
identical verdicts for platform-dependent programs or resource-limit boundaries.
Passing samples also does not imply passing hidden official tests.

Official **Submit** always uses the server pipeline below, including checker,
interactive, Advanced Mode, and special-environment judging.

## Durable execution and recovery

Before acknowledging a server submission, PostgreSQL commits its source pointer,
`JudgeExecution` and `submission.execution.dispatch` outbox row. The execution
points to a checksummed immutable object containing source files, testcase data,
workspace files, judge programs, limits, adjustment rules and the sandbox image.
Production images are pinned by registry digest in Helm. Local unpinned image
builds remain a development convenience and do not provide runtime reproducibility.
Problem generation is checked while accepting the execution; later edits cannot
change its snapshot.

`durableJudgeWorkflow` carries only the execution ID. Standard/checker executions
checkpoint each 20-case wave; interactive executions checkpoint each case.
Advanced run, grade and service form one atomic stage because their shared PVC
and service lifetime belong to one sandbox attempt. A failed Advanced stage
repeats that stage. Stage results live in immutable object storage; PostgreSQL
commits the pointer and next state together, including terminal compile errors.
The workflow continues as new after 100 iterations or Temporal's history signal.

Database admission grants four foreground turns to one background turn, FIFO
within each class, with unused capacity available to the other class. This ratio
counts stage admissions, not CPU time. Worker concurrency bounds active leases;
Kubernetes ResourceQuota remains the resource authority. An expired lease cannot
be reused until its old executor and sandbox resources are confirmed stopped.

Capacity contention remains waiting. Infrastructure failure enters recovery with
the original snapshot and bounded backoff; repeated/configuration/cleanup errors
become visible as blocked and retry every 15 minutes. No retry exhaustion turns
an infrastructure problem into a final student verdict. Namespace hard quotas
are checked for demonstrably infeasible requests; scoped quotas, unknown
admission defaults and node capacity remain subject to actual admission.

A teacher rejudge captures the latest effective version at the action's commit,
creates a new generation and audit log, and keeps the previous valid result
visible until replacement commits. Automatic recovery only changes its workflow
recovery epoch. Cancelling cannot interrupt a result already committed and still
finalizing score updates; another rejudge waits for that finalization to finish.
Historical SE records without snapshots are explicitly blocked because the
original version cannot be reconstructed safely from current problem contents.

Submission operation reads include the current execution state. The shared browser
tracker uses that state as well as the verdict, so recovering SE and retained
results do not end polling. Pending discovery includes nonterminal executions;
prepared batch progress comes from its captured children, and a cancelled child
cannot terminate tracking while other children remain active.

## Standard Mode pipeline

```
merge workspace files → prepare → execute per testcase → check → score
```

### Reference solution validation

Problem authors can submit a complete practice solution as a private reference submission. It uses the same Standard Mode judge, testcase set, workspace merge, and source storage as an ordinary submission, but is marked `isReferenceSolution` and excluded from student history and statistics. An accepted reference submission becomes the problem's current verification pointer; failed validation clears that pointer. The submission records the problem `storageGeneration`, and publication verifies that generation, so concurrent or completed changes to testcases, workspace files, judge configuration, limits, or problem type invalidate the pointer and cannot be published with an outdated reference solution.

### merge workspace files

Before the sandbox starts, the domain layer merges `ProblemWorkspaceFile` rows (editable + readonly + hidden) with the student's submitted files. Readonly and hidden workspace files always win over student paths, so a malicious client cannot overwrite them. Hidden files are never shown in the UI but are present on disk during compile/execute. The merge is implemented in `mergeSandboxSources()` inside `apps/worker/src/activities/judge.ts`.

Docker volumes and Kubernetes ConfigMaps use the same flat payload: testcase files
use `testcase-{i}-input.txt` / `testcase-{i}-expected.txt`, while merged source files
use opaque keys `source-file-{n}`. `sourceFileMap` restores the original workspace
paths inside the runner's private `workDir` before compilation. These separate
names prevent workspace paths from colliding with testcase or config payloads.
`readTestcase()` reads only the requested index.

### compile

Language-specific build, run by the sandbox runner inside the isolated container:

| Language   | Build command                                            | Entry file         |
| ---------- | -------------------------------------------------------- | ------------------ |
| C          | `gcc -O2 -std=c17 -o main ...`                           | `main.c`           |
| C++        | `g++ -O2 -std=c++20 -o main ...`                         | `main.cpp`         |
| Go         | `go build -o main .` (or single file)                    | `main.go`          |
| Java       | `javac -d . ...` then `java -cp . Main`                  | `Main.java`        |
| JavaScript | none; `node main.mjs`                                    | `main.mjs`         |
| Python     | none; `python3 main.py`                                  | `main.py`          |
| Rust       | `rustc -O -o main main.rs`                               | `main.rs`          |
| TypeScript | `tsc --strict --noEmitOnError ... --outDir compiled ...` | `compiled/main.js` |

JavaScript and Python skip the compile step entirely — a syntax error only surfaces when `execute` tries to run the file. TypeScript is compiled and type-checked with the pinned `tsc` toolchain; only the emitted JavaScript is executed.

With Kubernetes capacity admission disabled, each standard/checker Job wave has
its own hardened `prepare` init container and compiles into that Pod's
`/artifact`. A submission spanning several waves therefore recompiles for each
wave. The legacy chart defaults permit up to 20 testcase containers per wave;
this is not a guaranteed concurrent-submission capacity.

With capacity admission enabled, a standard/checker attempt first acquires a
prepare permit and creates one run-owned `ReadWriteOnce` artifact PVC. Its
StorageClass must use `WaitForFirstConsumer`. Preparation compiles once into
bounded scratch, then a separate publisher validates and copies the artifact
under the existing 256 MiB limit. Symlinks, special files and unsafe paths are
rejected; executable permissions are validated. The artifact excludes testcase
answers and checker private data. Later waves mount it read-only and use fresh
testcase containers, cgroups and scratch. Required node affinity and the bound
volume preserve placement through the Kubernetes scheduler; the admitted path
does not set `nodeName` to bypass scheduling. Loss of the artifact ends the
attempt; a retry uses a new run ID and compiles again after cleanup.

Docker retains its existing per-submission prepare flow. Interactive containers
retain their paired solution/interactor semantics; Advanced Mode retains its
run/grade contract. Both participate in admission when the feature is enabled.

### execute

One sandboxed process per testcase. Stdin comes from the testcase `input`, stdout/stderr/exit code/runtime/memory are captured. Per-case limits come from `Problem.judgeConfig.runtime`:

- `timeLimitMs` — 100 ms to 30 s, default 1000 ms
- `memoryLimitMb` — 16 MB to 1024 MB, default 256 MB
- `env` — extra environment variables injected into the process

**Memory: measured verdict vs. container hard limit.** MLE is decided _post-hoc_ by comparing each case's measured peak RSS (read from cgroup `memory.peak`) against the per-problem `memoryLimitMb` — `enforceMemoryLimit` reclassifies an otherwise-AC/WA run as MLE when `memoryKb > memoryLimitMb` (DOMjudge-aligned: MLE is judged by the measured number, not by OOM-kill). For that measurement to be accurate, the container's hard cgroup limit (`--memory` on Docker, the pod `resources.limits.memory` on K8s) must be **higher** than the per-problem allowance, otherwise the kernel would SIGKILL a legitimate submission at the boundary before the peak can be observed (reported as RE/MLE). So the hard limit is derived per submission as `min(memoryLimitMb + SANDBOX_MEMORY_HEADROOM_MB, SANDBOX_MAX_MEMORY_MB)` (never below `memoryLimitMb`), via `resolveContainerMemoryMb` (`packages/core/src/sandbox.ts`); the cluster-wide `SANDBOX_MEMORY_MB` / `K8S_MEMORY_LIMIT` is now only the **fallback default** when a problem declares no limit. Defaults: headroom 64 MB, platform ceiling 1536 MB (1536 Mi in Kubernetes); the largest 1024 MB authoring limit therefore resolves to 1088 MB and does not consume the full safety ceiling.

The **effective** per-run time budget is `timeLimitMs × LANGUAGE_TIME_FACTOR[language]` (`packages/core/src/judge/time-factor.ts`), applied once where the sandbox request is built (`apps/worker/src/activities/judge.ts`). Compiled-native languages (c/cpp/rust) use factor 1.0; slower runtimes get a multiplier (go 1.5, js/ts/java 2, python 3) so the same problem is fair across languages, mirroring DOMjudge's per-language `time_factor`. Because every downstream ceiling (CPU soft TLE, CPU rlimit, wall-clock grace, docker/k8s deadlines, validator timeout) derives from this `timeoutMs`, they all scale together. The factor does not apply to Advanced Mode. Memory has no per-language factor (neither does DOMjudge).

**Kubernetes admission failures.** Quota rejection takes precedence over generic
`forbidden` classification. Direct resource creation and controller `FailedCreate`
use the same policy, including Advanced service and PVC admission. Persistent
contention returns `SandboxBackpressureError` after confirmed cleanup; the durable
workflow releases the activity slot and waits 30 seconds. A Pod's `startTime`
does not prove execution: only regular-container running/termination evidence
starts the execution deadline. Pre-execution deadline expiry stays on the capacity
path. Deterministic rejection and demonstrably infeasible hard-quota requests
enter blocked recovery. Failed cleanup retains its lease until reconciliation.

All Standard Mode containers run with `--network none`, `--cap-drop ALL`, `--security-opt no-new-privileges`, a read-only rootfs, and bounded `tmpfs` mounts on `/tmp` (64m) and `/workspace` (128m). Kubernetes Job completion is observed through resource-versioned Job/Pod watches with snapshot resync on disconnect; it does not rely on a fixed polling interval.

### check

Per-testcase verdict. The strategy is chosen by `judgeConfig.type`. The crucial
fairness invariant for the non-standard strategies is **run/check separation**:
the container that runs untrusted student code never mounts the expected answers
or the validator source. Only the worker (or a second isolated container that
holds no student code) makes the AC/WA decision.

- **`standard`** — token-based comparison matching the DOMjudge/ICPC default output validator, in `packages/core/src/judge/compare.ts` (`compareStandard`). Both sides are split on runs of ASCII whitespace (space, tab, CR/LF, vertical tab, and form feed), and the resulting token lists must match element-for-element. Whitespace amount and line structure are therefore always irrelevant (`"1 2"` = `"1  2"` = `"1\n2"`); this is hard-wired and not configurable. Two per-problem knobs, set by the problem author and stored in `judgeConfig.compare`, refine token matching:
  - `caseSensitive` (default `true`) — when `false`, ASCII letters compare case-insensitively; Unicode letters are preserved. Note: NOJV defaults to **strict** case matching, the opposite of DOMjudge's default validator (case-insensitive); authors who want DOMjudge-equivalent leniency must set this `false` per problem.
  - `floatTolerance` (default unset = exact) — when set to ε, two numeric tokens match if they are within absolute **or** relative error ε (the DOMjudge `float_tolerance` shorthand). Decimal and hexadecimal float tokens use 40-digit decimal arithmetic to avoid losing 64-bit integer distinctions through JavaScript Number. NaN matches NaN; infinities must have the same sign. Text tokens follow the configured case rule. This does not promise bit-identical rounding at every platform-specific native long-double boundary.

  The run container only emits each case's raw stdout/stderr/exit (`rawRuns`); the worker performs the comparison against the answer it holds, so `judgeConfig.compare` only needs to reach the worker. Anything token comparison cannot express (multiple valid answers, structural checks, etc.) must be implemented as a **checker**.

- **`checker`** — a teacher-provided **DOMjudge output validator** (`python` / `cpp`) that renders an **AC/WA verdict only** (no partial scoring). The run container produces `rawRuns` (no answer present); the worker prepares the checker in a separate compile container, then launches an **isolated validator container** (`validator-executor.ts` → sandbox-runner `runValidate`) for the clean cases. The validator is invoked as `validator <input> <judge_answer> <feedback_dir>` with the team output on stdin and must **exit 42 (accept) or 43 (wrong)**; any other exit is treated as a validator/system error. Feedback travels through files in `feedback_dir`: `teammessage.txt` (shown to the student) and an optional `judgemessage.txt` (operator-only). Python TAs get a wrapper binding `judge_input` / `judge_answer` / `team_output` plus `accept()` / `wrong()` / `judge_log()` (`apps/sandbox-runner/assets/wrappers/python-validator.py`); C++ TAs implement the bare interface.
- **`interactive`** — a teacher-provided **DOMjudge interactor**, run as **two isolated containers** wired by a worker byte proxy (`interactive-executor.ts` → sandbox-runner `runInteractive`): the solution container runs student code with its stdio bridged to the interactor container, and the secret input/answer is mounted only into the interactor side. The interactor uses the same exit-42/43 + `feedback_dir` protocol as the validator, but its Python wrapper exposes live `read()` / `write()` instead of a fixed `team_output` blob (`apps/sandbox-runner/assets/wrappers/python-interactor-domjudge.py`).

On K8s, `checker` separates the student execution Jobs from a validation Job.
Student ConfigMaps omit expected answers and the validator script; the validator
Job uses its own ConfigMap with no student source, compiles the validator and
grades captured team outputs. The worker merges outcomes via `mergeCheckerResults`
(the same merge as Docker). With capacity admission, preparation and testcase
waves precede a separately admitted checker stage; “two Jobs per submission” is
not the resource model. Per-case validator files use flat keys
(`case-{i}-{input,answer,team}.txt`) because ConfigMaps cannot hold nested paths.
`interactive` runs one Job per testcase with solution/interactor containers wired
over a `socat` TCP bridge on port 7777; only the interactor mounts secret
input/answer data. `advanced` uses its separate run/grade Jobs and PVC contract.

After compiling, both trusted interactive runners exchange a bounded peer-ready
frame before starting either program or its execution timer. The runners consume
this frame and preserve any prefetched conversation bytes when piping input to
the programs; compilation and peer startup do not consume the student time limit.
Startup EOF, malformed readiness, or timeout is a platform error. Each runner
closes its input after reporting completion so its peer receives EOF promptly.

Interactive runner reports use typed stderr markers; after readiness, stdout carries
only the solution/interactor conversation. Student compilation failures produce the same
submission-level CE result as standard judging. Interactor compilation failures
remain platform errors, with compiler diagnostics available only to staff.

### score

Subtask scoring is **all-or-nothing**: a `TestcaseSet` (subtask) earns its full `weight` only if **every** case in it is AC, otherwise 0. There is no per-subtask strategy column and no per-case partial credit — checkers/interactors render AC/WA only. This is uniform across practice, assignment, contest, and exam; contests adjust whole-**problem** aggregation (see [Architecture](./ARCHITECTURE.md)), not the subtask AC-all decision.

The raw score is `Σ rawScore`, where each subtask's `rawScore` is `weight` (all cases AC) or `0`. This happens in `buildSubtaskResults()` and `mapResult()` inside `packages/application/src/submission/scoring.ts`. The raw score then goes through the post-judge adjustment step (see [Adjustment rules](#adjustment-rules)).

### Judge-type parity note

Standard, checker, and interactive execution keep answers and judge code in the
worker or isolated validator/interactor containers, outside the student sandbox.
Advanced Mode enforces the same separation through its run/grade topology. All
judge types use the immutable version and recovery contract described in
[Durable execution and recovery](#durable-execution-and-recovery).

## Advanced Mode pipeline

Advanced Mode is the escape hatch for problems that need custom toolchains, binary I/O, a controlled public-API call, or anything else Standard Mode can't express. Unlike Standard Mode, the platform does not compile/execute the student itself — but it **does** own the topology and the student-side hardening. The model is a **run/grade two-phase split** that reuses the same `run/check separation` invariant as `checker`/`interactive`: the container that runs untrusted student code never holds the answers, and only a separate, time-separated container with no student code makes the grading decision. Full rationale (and the rejected alternatives) lives in the design doc: [Advanced Judge run/grade split](../plans/completed/2026-06-14-advanced-judge-run-grade-split-design.md).

### Run/grade two-phase split

Per submission the worker orchestrates two **time-separated** phases plus, optionally, one network sidecar — all ephemeral (fresh per submission, destroyed in `finally`):

1. **run phase** — a **run container** (untrusted: holds the student code, hardened, runs as uid `10001`) plus at most one network sidecar. It reads its baked-in testcase **inputs**, runs the student program, and writes per-case outputs + a status marker into `/workspace/output/`. It holds **no answers**.
2. **capture** — after the run container exits, the platform captures `/workspace/output/` host-side via `safeCopyTree` (the answer-leak gate, below) into the grade workspace. The worker derives a `runStatus` from how the run container ended.
3. **teardown** — run container + sidecar + per-submission networks are removed.
4. **grade phase** — a **grade container** (trusted TA, holds the baked-in answers in its image rootfs, runs non-root as uid `10001` with **no network egress**, **no student code**) mounts the captured run output read-only at `/workspace/run-output` plus a `meta.json` carrying `runStatus`, and writes `/workspace/output/result.json`. Because the grade container holds the answers, closing its egress removes an exfiltration channel; it never needs the network (its inputs arrive via the mount, its result via the log/output file).

Docker orchestration lives in `apps/worker/src/services/advanced-mode-executor.ts` (`AdvancedModeExecutor.run`); the K8s equivalent in `k8s-executor.ts` (`executeAdvanced`) + `k8s-advanced.ts` + `k8s-advanced-network.ts`.

### Container contract

The **run container** sees:

```
/workspace/submission/   student files (from ZIP or wrapped single source)
/workspace/meta.json     { submissionId, language, submissionFiles, resourceLimits }
/workspace/output/       run harness writes student outputs here (binary OK)
(testcase INPUTS baked into the run image — not secret)
```

`meta.json.submissionFiles` is the **actual list of relative paths the worker wrote into `submission/`** for this run (i.e. the post-merge layout), not a static declaration; TA run harnesses should iterate this array rather than scanning the filesystem. The run harness owns compiling and running the student (it gets `meta.json.language` + the files) — the platform does not compile the student in Advanced Mode. A compile failure is the run harness's to detect and report (write a marker into `/output`); the grade harness maps it to the `compile_error` verdict. Built by `prepareRunWorkspace()`.

The **grade container** sees:

```
/workspace/run-output/        the captured run /output, mounted READ-ONLY (binary OK)
/workspace/meta.json          { submissionId, language, runStatus }
/workspace/output/result.json grade harness writes here
(ANSWERS baked into the grade image — never exposed to the student)
```

`runStatus` (`{ state: "exited" | "timed_out" | "oom_killed", exitCode }`, built by `deriveRunStatus`) is the worker-observed outcome of the **whole** run container; the grade harness uses it to emit a catastrophic-failure verdict, while ordinary per-case TLE/RE/WA is decided by the run harness and conveyed through `/output`. The grade `meta.json` deliberately does **not** carry the network mode (a proxy denial is just a connection error to the student program). Built by `prepareGradeWorkspace()`.

**Binary I/O.** Inputs and outputs flow as a raw byte directory, never a JSON string or stdin text, so image/audio/arbitrary-binary files survive intact: the run harness writes arbitrary files to `/output`, the worker copies them byte-for-byte (`copyFile`, never UTF-8 decoded), and the grade harness does the decode + comparison in code (Pillow/librosa/etc., baked into the grade image). The platform never interprets binary semantics.

### `result.json` schema

Unchanged — validated against `advancedResultSchema` in `packages/core/src/schemas/advanced-mode.ts`:

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

The grade harness owns grading: `score` (0 to the configured `maxScore`, default 100) is authoritative; per-case detail flows through `testcases[]` (advanced problems have no platform testcase sets). A `compile_error` verdict is surfaced as a compile failure (score 0), matching standard mode.

### Verdict ownership and System Errors

The worker funnels every run outcome through `runStatus` and **always proceeds to grade** after a run that did not _infrastructurally_ fail — including an **empty `/output`** (a student that printed nothing is a legitimate WA/RE for the grade harness to render, not a platform fault). The worker raises a **System Error** (`advancedFallbackResult`, every testcase → `SE`) only on infrastructure failures: run/grade container **spawn** error, run/output **size-cap exceeded** (`safeCopyTree` `SafeCopyLimitError`, or the during-run watchdog), grade **timeout**, and a missing/unreadable/malformed `result.json`. On K8s the same set applies plus the **transfer-sidecar non-zero exit** (a capture-gate or IO failure inside the run Pod → SE, grade never created). A run/grade Pod stuck in **`ImagePullBackOff`** (a bad or unpullable image ref never heals) ends that sandbox attempt: `k8s-executor.ts` throws `SandboxImagePullError`. The durable execution records the infrastructure failure and retries the pinned image after backoff; it never substitutes another version. A single **`ErrImagePull`** (the first pull attempt, which may be a transient registry blip) is **not** terminal — the executor keeps polling until kubelet either recovers or escalates to `ImagePullBackOff`. Pod **`Evicted`**, `Shutdown`, `NodeLost`, `Preempted`, and equivalent Spot/node interruption reasons are infrastructure failures instead: the executor throws a retryable error so Temporal recreates the ephemeral sandbox. OOM, TLE, and program errors remain normal verdicts.

### `advancedConfig` (image sources + network policy)

The TA configures the problem via the `Problem.advancedConfig` JSON column (`advancedConfigSchema`), holding per-role images and a network policy:

```jsonc
advancedConfig: {
  run:   { imageRef, imageSource: "registry" },
  grade: { imageRef, imageSource: "registry" },
  network: {
    mode: "none" | "service",                 // default "none"
    service?: { imageRef, imageSource }         // mode = "service"
  }
}
```

`imageRef` is a **digest-pinned** registry reference (`ghcr.io/org/judge@sha256:...`), restricted to `ADVANCED_IMAGE_ALLOWED_REGISTRIES` at the input layer. `special_env` validation (`packages/core/src/schemas/problem.ts`) requires both `run` and `grade`, and a `service` image iff `mode = "service"`. `advancedRequiredPaths` (a separate optional `Problem` column) still governs the student **upload** shape — the set of relative paths a submission ZIP must contain — and is unrelated to `advancedConfig`.

### Network modes

The run container is always **single-homed with no direct internet route** and can reach **at most one** sidecar:

| mode             | run reaches                   | extra container | use                                  |
| ---------------- | ----------------------------- | --------------- | ------------------------------------ |
| `none` (default) | nothing                       | —               | offline judging                      |
| `service`        | isolated TA service container | service         | student talks to a mock/DB/simulator |

- **`service`** — a TA-provided dependency (mock API / DB / simulator) that is network-isolated. The run container reaches it at `NOJV_SERVICE_HOST=host:8888` over the internal network; the service has no egress route.

### Backends

Both the Docker backend (local/dev) and the Kubernetes backend (GKE prod) are supported; no backend is abandoned.

**Docker** (`advanced-mode-executor.ts` + `docker-network.ts` + `service-container.ts`). `none` → `--network none`. `service` creates a per-submission internal-only network shared only by run and service. Neither container has a route to the internet. The network is torn down on the `finally` path.

**Kubernetes** (`k8s-executor.ts` + `k8s-advanced.ts` + `k8s-advanced-network.ts`). Run and grade are **two separate Jobs**; run output crosses between them over a per-submission **`ReadWriteOnce` PVC** (lossless binary, no ConfigMap 1 MB limit). A native `transfer` sidecar in the run Pod runs the **same `safeCopyTree` gate** on TERM, copying `/output` → PVC; the grade Pod mounts the PVC read-only on the run Pod's node. The legacy manifest uses `spec.nodeName`; capacity-admitted execution replaces this with required node affinity so the scheduler still checks resources and volume placement. Because all containers in one Pod share a netns, the egress sidecar **must** live in a **separate Pod** (this is the one place Advanced differs from `interactive`, which can co-locate over `127.0.0.1`). Egress isolation is per-submission `NetworkPolicy`:

- The blanket deny-all (chart template `infra/charts/nojv/templates/sandbox-policy.yaml`) selects on `nojv.egress` **`DoesNotExist`**, so standard/checker/interactive Pods and `mode=none` advanced run Pods (none carry the label) stay denied. The service-mode run Pod is relabeled `nojv.egress=<id>` and gets `buildRunEgressPolicy` allowing egress **only** to the service Pod (no `0.0.0.0/0`, no `ipBlock`, no kube-dns) with `ingress: []` (the untrusted run Pod is never a server). The grade Pod is labeled `nojv.egress=<id>-grade` and gets an explicit per-submission **deny-all egress** policy (`buildGradeEgressPolicy`, `egress: []`) in **every** mode. The service Pod gets ingress only from the run Pod and **no egress**, is fronted by a per-submission ClusterIP Service, and `NOJV_SERVICE_HOST` uses that **ClusterIP literal**. The worker is granted `pods`/`services`/`networkpolicies`/`persistentvolumeclaims` in the chart's `infra/charts/nojv/templates/worker-rbac.yaml`.
- **CNI enforcement is a hard dependency.** Every NetworkPolicy above is a **no-op** unless the cluster's CNI actually enforces NetworkPolicy (GKE Dataplane V2 / Cilium / Calico). A non-enforcing CNI installs the API objects but lets the run or service Pod reach the internet while every policy "exists". The production smoke test must affirmatively assert egress is blocked.

### Hardening posture

| flag                | run (untrusted)            | grade (trusted) | service (trusted)     |
| ------------------- | -------------------------- | --------------- | --------------------- |
| `--cap-drop ALL`    | yes                        | yes             | yes                   |
| `no-new-privileges` | yes                        | yes             | yes                   |
| `--read-only`       | yes                        | yes             | yes                   |
| `--user` non-root   | **yes (10001)**            | **yes (10001)** | **yes (10001)**       |
| network             | only its service (or none) | **none**        | ingress from run only |
| holds answers       | **never**                  | yes (baked)     | never                 |

All three roles share `--cap-drop ALL`, `no-new-privileges`, `--read-only` rootfs, resource bounds, and uid/gid `10001`; on K8s they use the equivalent pinned hardened `securityContext`. Both grade and service have **no egress**. Writes are permitted only to `/tmp` and `/workspace`. A watchdog kills the run if its workspace exceeds **1 GiB** or **100k files**. Advanced Mode skips the in-browser editor: students submit a ZIP (or a single source file wrapped into `sourceFiles`).

### Capture safety (the answer-leak gate)

`/output` is written by untrusted student code, so the host-side capture is the security-critical step. `safeCopyTree` walks the run container's static, post-exit `/output` and, per entry, `lstat`s **before** any `isFile`/`isDirectory` branch:

- **Skips every symlink** (the core gate, never copied and never dereferenced). A malicious `output/x → /answers/secret` (absolute) or `→ ../escape` (relative) therefore never reaches `grade/run-output`, so nothing can resolve against the grade container's baked-in `/answers`. Because no symlink is ever dereferenced, the capture can't be tricked into reading host secrets either.
- **Skips special files** (FIFOs, sockets, device nodes) without `open()`ing them, so a FIFO can't hang the capture.
- **Copies regular files as raw bytes** (binary-safe), throwing `SafeCopyLimitError` (→ SE) past 100k files or 1 GiB.

It is host-side rather than an in-container `tar --dereference` because the run container is `--rm` and gone the instant its main process exits — and keeping the gate in platform (not TA) code means it is unit-tested without Docker, with no TOCTOU window against the dead container's static bytes. The K8s `transfer` sidecar runs a byte-identical embedded copy of this gate inside the answer-free run Pod (cross-gate parity locked by test).

### Authoring run/grade judge images

TAs don't hand-write the boilerplate. The problem edit page (Advanced settings → Container contract) has a **Download starter templates** button (`GET /api/problems/advanced-scaffold`) that streams a package of per-role image templates — `run`, `grade`, and `service`, each a `Dockerfile` + contract helper + README — plus a top-level README covering how to build each image, push it to a registry, and paste the digest ref back into the editor (the in-app Advanced Mode guide at `/guides/advanced-mode` walks through the same). Each role:

- **run** — `runner.py` (load `meta.json`, compile/run the student per case, write `/output`) + a `Dockerfile` baking testcase **inputs**.
- **grade** — `grader.py` (read `/run-output` + the baked-in `/answers`, decide verdicts, write `result.json`) + a shared stdlib-only `nojv_grader.py` helper (validate/normalize verdicts, `write_result`) the TA does **not** edit + a `Dockerfile` baking the **answers**.
- **service** — a minimal HTTP service example listening on `PORT` (8888).

Workflow: **download the templates → edit `runner.py` / `grader.py` (+ testcases/answers) → `docker build` each → push to an allowlisted registry → paste the digest-pinned refs into the problem editor**. `infra/docker/demo-advanced-{run,grade}` are worked examples of the same contract. The canonical `result.json` verdicts are the long forms at the top level and the short codes (`AC`/`WA`/`TLE`/`MLE`/`RE`/`SE`) per testcase — `write_result` accepts either and normalizes.

Because answers live **only** in the grade image and student code **only** in the run container, answer protection is a **platform guarantee** rather than TA discipline: a malicious submission cannot read the answers (they are in a different, time-separated container), reach the grade container, or leak an answer through an `/output` symlink.

### `advancedConfigSnapshot` (audit, not a judging input)

`Submission.advancedConfigSnapshot` (`Json?`) is a pure **audit record** written at judge completion — _which_ `advancedConfig` graded this submission (overwritten on every judge/rejudge; null for non-advanced). It is **never** read back into judging. An explicit teacher rejudge reads the latest `Problem.advancedConfig` at acceptance and pins it in the new execution snapshot. Automatic recovery reads that snapshot, so a subsequent image/configuration edit cannot change the in-flight version.

## Problem types

`Problem.type` drives the shape of the submission and how the judge pipeline assembles it:

- **`full_source`** — the student submits one complete source file. Content lands at `main.<ext>` in the sandbox workspace.
- **`multi_file`** — the teacher ships a scaffold (main + helpers); the student edits designated files in-browser. Every enabled language ships exactly one editable `main.<ext>`. Teachers achieve LeetCode-style "student implements a named function" by marking the function file as `visibility: "editable"` and the driver file as `visibility: "readonly"`.
- **`special_env`** — Advanced Mode. The platform orchestrates a TA-provided **run** image (executes the student) and a separate **grade** image (holds the answers, decides the verdict); the student uploads a ZIP. See [Advanced Mode pipeline](#advanced-mode-pipeline).

## Workspace files

`ProblemWorkspaceFile` is the authoritative source for starter code, scaffolding, and hidden assets. Each row has a `visibility` that fully governs student edit access — there is no sub-file granularity:

| Visibility | Shown in UI      | Student can edit | Present in sandbox |
| ---------- | ---------------- | ---------------- | ------------------ |
| `editable` | yes              | yes (whole file) | yes                |
| `readonly` | yes (greyed out) | no               | yes                |
| `hidden`   | no               | no               | yes                |

Visibility is enforced on the server: `mergeSandboxSources()` rebuilds the sandbox workspace from `ProblemWorkspaceFile` plus the student's submitted contents for `visibility: "editable"` files only. A tampered client cannot inject replacements for `readonly` or `hidden` paths — the teacher version wins.

## Adjustment rules

Late penalties are configured on assignments and exams through `adjustmentRules`. The post-judge `mapResult()` step calls `applyAdjustmentRules()` with the raw problem score, problem maximum, runtime, submission receipt time and on-time deadline (`dueAt`). Contests do not carry adjustment rules.

- `time_bonus` (assignments only): linear runtime bonus, skipped when `baselineMs <= 0`.
- `flat_late_penalty`: if `submittedAt > dueAt`, multiply the score by `1 - penaltyPct / 100` once.
- `daily_late_penalty`: if `submittedAt > dueAt`, multiply by `max(0, 1 - ceil((submittedAt - dueAt) / 86_400_000) * perDayPct / 100)`. A fraction of a day counts as a full day. Exactly 24 hours is one day; 24 hours plus 1 ms is two days.

After each adjustment the score is rounded and clamped to the problem's maximum. Each activity supports at most one late penalty; assignments may additionally have runtime bonuses. A late penalty requires a due date strictly before the final collection deadline. Missing due dates with configured penalties are invalid, not silently ignored.

The hard collection deadline is enforced when accepting submissions, separately from grading: `Assessment.closesAt` / `Exam.endsAt` reject submissions at or after the deadline. Rules cannot start from the hard deadline, and closing an activity never zeroes previously earned scores. Official per-problem grades use the best adjusted submission score; practice submissions have no activity context and never enter those grades. Exam sessions and proctoring continue until `endsAt`, including the late window.

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

## Source and result storage

Submission upload first creates a `pending_upload` intention. Source objects and
the immutable judge snapshot are uploaded under guarded unique keys; the
transaction then publishes the source manifest, execution and dispatch outbox.
A failed upload is not acknowledged as an accepted submission. New judging reads
its snapshot, while plagiarism reads canonical source files from the source
manifest.

Full verdict detail is written to an immutable owner-specific `judge-runs` key.
PostgreSQL commits its checksummed pointer with the summary and score. Stage
checkpoints and input snapshots also use verified object pointers; neither large
source nor testcase payloads enter workflow history. Storage write guards clean
uncommitted objects after the reader grace interval. Snapshot retention must cover
the lifetime of every recoverable execution; losing one blocks recovery instead
of falling back to current problem data.

## Activity / workflow boundary

New executions use `durableJudgeWorkflow`; existing legacy workflow definitions
remain registered so previously persisted histories can still replay.
Effectful work stays in activities; the workflow carries an execution ID and,
for capacity-controlled execution, its durable strategy and current run identity.

Legacy dispatch payloads without a pinned execution are retired without starting a workflow. The legacy sweeper preserves a verified active owner; when that owner is missing or closed, it marks the original version unavailable and cancels outstanding initial dispatch atomically. A delayed legacy start cannot revive this blocked submission. A fresh teacher action creates the new pinned execution.

| Activity proxy                            | Start-to-close | Heartbeat | Attempts per workflow iteration |
| ----------------------------------------- | -------------- | --------- | ------------------------------- |
| Execution journal / final result          | 2 min          | —         | 3                               |
| One sandbox stage / orphan reconciliation | 70 min         | 60 sec    | 1                               |
| Score effects and notifications           | 2 min          | —         | 3                               |

The sandbox budget covers up to two 30-minute run/grade Jobs plus transfer and
cleanup. Heartbeats begin before snapshot I/O and continue during cleanup.
After bounded activity failure, a durable timer delays the next attempt; the
iteration/history bound does not discard database checkpoints or pinned content.

### Capacity admission and fairness

`judgeAdmissionWorkflow`, with workflow ID `judge-admission-v1`, runs on the
separate `judge-control` task queue. The enabled chart creates a dedicated
control-worker Deployment, so waiting for judge execution activity slots does
not block capacity refresh or cleanup. A newly created coordinator is paused.
Quota management initially remains disabled. Operators complete the retained
quota handoff, signal `activateJudgeQuota`, verify successful reconciliation,
then explicitly resume admission. Web/platform dispatch uses an awaited
coordinator update when `JUDGE_CAPACITY_ROUTING=true`; `hold` persists new
submissions to the unpolled staged queue while legacy work drains. The staged
worker polls `judge-capacity-v1`, keeping those histories separate from `judge`.
Dispatch, drain and rollback verification are documented in the capacity runbook.

Every 30 seconds the controller reads eligible `nojv-role=sandbox` nodes and
effective non-judge Pod requests. Per-node CPU and memory budget is allocatable
minus the larger of committed non-judge requests or 25% of allocatable. Effective
requests include init containers, native sidecars and Pod overhead. Missing or
more-than-90-second-old snapshots stop new admissions. Existing permits remain
accounted for through worker restarts and node budget reductions.
Nodes reporting MemoryPressure, DiskPressure or PIDPressure as True or Unknown
receive no new permits. Fresh snapshots restore eligibility when those conditions
clear; FailedKillPod quarantine remains persistent until operator recovery.

Standard testcases request and limit one CPU; the complete problem memory limit
plus platform headroom is reserved. Preparation reserves one CPU and at least
512 MiB. Each admission pass first assigns one case to each ready student in
round-robin order, then distributes additional cases in the same order until
the artifact node's CPU/memory budget or each request's remaining cases run out.
There is no fixed four-case ceiling: an uncontended submission can use the free
node budget, while concurrent submissions share it. Held permits and Pod overhead
are counted before expansion. A waiting large request reserves its node from
later small requests and wave expansion so its capacity can accumulate.
Only newly granted waves expand; running work is neither resized nor preempted.
Interactive and Advanced Mode reserve their combined containers and overhead.
Admission waits use workflow conditions, not executing activity slots or stage
execution timeouts. Student round-robin order, FIFO submissions per student and
one active permit per student prevent overlapping waves from the same student.
Durable dispatch reserves each execution before initialization. A control
Activity also checks the persisted execution journal before the first attempt;
a later accepted submission waits in its Workflow while the same student has
earlier unfinished work, even if that earlier dispatch has not arrived.
FIFO waiters register with the durable coordinator and sleep until a targeted
wake signal. One batched journal read reconciles them on registration, completion
and routing changes, with a central 30-second fallback for database-only
cancellation or missed notifications. A wake never grants admission: the execution
rechecks database order and ownership before initialization. Pending first permits
also wait for a durable reply without a per-submission timer; once an attempt is
claimed, its existing 30-second ownership heartbeat remains active between stages.
Each FIFO check reads an execution-specific coordinator query containing only
the dispatch route, drain flag and active status. It does not transfer the full
admission backlog; waiting executions still check whether rollback requires a redirect.
Retries and recovery epochs retain the original execution ordering key.
Executions carry the journal's queue class: `foreground` for student submissions
and `background` for rejudges and recovery epochs. A student's foreground
execution is the FIFO head ahead of that student's background work regardless
of age, the coordinator admits foreground students before background students
while keeping round-robin within each class, and a background rejudge keeps its
prepared artifact and resumes as soon as no foreground request is grantable.
The coordinator resolves unknown run priorities from the journal in one batched
read before each admission pass, so legacy reservations converge without a
history rewrite.
Prepared unfinished runs are bounded to twice the available CPU execution slots
per priority class, so a bulk rejudge cannot hold every prepared slot against
new submissions.

Temporal's in-memory Workflow cache is bounded independently of sandbox admission
and Activity concurrency. Judge, control and platform workers each retain at most
32 cached Workflows and execute at most 8 Workflow tasks concurrently. These caps protect the
worker's own heap when many submissions wait for admission. Evicted Workflows
remain durable in Temporal and replay when needed; eviction neither cancels a
submission nor releases its sandbox permit.

The capacity route uses the same immutable execution snapshot and journal as
baseline judging. Each completed wave commits its actual testcase indices while
retaining the attempt lease until artifact cleanup. Recovery starts a new run,
compiles the pinned source again and skips committed indices; it never assumes
that a capacity-sized checkpoint represents the baseline's twenty-case stage.
The execution's capacity strategy survives recovery epochs. A checkpointed
execution cannot be redirected to the baseline during rollback. Only untouched,
cleaned executions can relinquish that strategy.

Stage inputs and outputs use immutable verified object-storage pointers rather
than putting full source/testcase/output payloads into Temporal history. Attempt
cleanup removes the run's Jobs, Pods, ConfigMaps, PVC and temporary result
objects. Public submission APIs, verdict definitions, language multipliers and
scoring remain unchanged. There is no cross-submission compilation cache.

## Reliability notes

- **Termination before release** — Kubernetes cleanup requests foreground deletion with UID preconditions and waits for owned Pods to disappear under the normal 30-second cleanup budget. A timeout or ownership change raises `cleanup_pending`; durable cleanup retries retain the permit. Known runtime incidents additionally require host-side process and cgroup verification: Kubernetes API disappearance alone is not proof of runtime termination.
- **Quarantine** — the control worker records nodes with repeated `FailedKillPod` events (count at least three) in durable coordinator state and stops new admissions there. Healthy nodes remain eligible. It does not restart containerd, k3s or runsc, and this does not claim to fix the runtime's underlying fault.
- **Phase evidence** — `judge_phase_duration_seconds` separates queue, admission, schedule, startup, prepare, execute, checker, collect, cleanup and end-to-end observations. Kubernetes lifecycle timestamps give scheduling/startup and container durations; startup includes image pull and runtime startup together. Worker timers measure activity-side phases. CPU/throttling/peak-memory observations come from runner cgroup telemetry. Labels are bounded to phase/mode/language/result; submission and run IDs belong in structured logs. Unavailable lifecycle or resource data is not zero.

- **Bounded stdout/stderr buffers** — both the worker (`apps/worker/src/services/bounded-buffer.ts`) and the sandbox runner (`apps/sandbox-runner/src/utils.ts` → `createBoundedBuffer`) cap captured output at 16 MB per stream. A runaway submission that prints infinite output will hit the cap, get a `[output truncated — exceeded N bytes]` marker, and continue to the per-case timeout instead of OOM-killing the runner or worker. The two buffers are intentionally kept as separate copies — pnpm workspace deps don't allow cross-app imports.
- **Sandbox temp-dir cleanup** — the runner wraps the main judging step in try/finally and calls `cleanupTempDir(workDir)` (from `apps/sandbox-runner/src/utils.ts`) on its `mkdtemp` work directory on exit, so a container restart between runs does not leak workspace state.
- **Outer container timeout** — Standard Mode uses `request.limits.timeoutMs * testcases.length + 30 s` as the docker-level kill timeout; Advanced Mode uses `advanced.totalTimeMs + 30 s`. The 30 s grace covers Docker startup/teardown overhead.

## Where the code lives

- Worker entrypoint — `apps/worker/src/index.ts`
- Standard Mode executor (Docker) — `apps/worker/src/services/standard-mode-executor.ts`
- Isolated checker validator executor (Docker) — `apps/worker/src/services/validator-executor.ts`
- Isolated interactive two-container executor (Docker) — `apps/worker/src/services/interactive-executor.ts`
- Advanced Mode run/grade executor (Docker) — `apps/worker/src/services/advanced-mode-executor.ts` (`safeCopyTree` answer-leak gate, `deriveRunStatus`, network-mode branch)
- Advanced Mode Docker networking + service sidecar — `apps/worker/src/services/docker-network.ts`, `service-container.ts`
- Advanced Mode K8s manifests (two Jobs + PVC + transfer gate) — `apps/worker/src/services/k8s-advanced.ts`
- Advanced Mode K8s networking (per-submission NetworkPolicies + sidecar Pod/Service) — `apps/worker/src/services/k8s-advanced-network.ts`
- Kubernetes executor (standard/checker prepare and testcase waves, separate validation, interactive paired containers, advanced run/grade) — `apps/worker/src/services/k8s-executor.ts`
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
- Durable judge workflow — `apps/worker/src/workflows/durable-judge.ts`
- Legacy workflow replay — `apps/worker/src/workflows/submission-judge.ts`
- Durable judge activities — `apps/worker/src/activities/judge-execution.ts`
- Pinned request builder — `apps/worker/src/activities/judge-request.ts`
- Capacity stage workflow / activities — `apps/worker/src/workflows/durable-capacity.ts`, `apps/worker/src/activities/judge-stages.ts`
- Admission coordinator / capacity arithmetic — `apps/worker/src/workflows/judge-admission.ts`, `apps/worker/src/services/judge-capacity.ts`
- Capacity refresh / quota ownership — `apps/worker/src/activities/judge-control.ts`, `apps/worker/src/services/judge-quota.ts`
- Judge context builder (`getJudgeContext` / `parsePersistedAdvancedConfig`) — `packages/application/src/submission/queries.ts`
- Score aggregation (`buildSubtaskResults`, `mapResult`) — `packages/application/src/submission/scoring.ts`
- Score adjustments — `packages/application/src/submission/adjustments.ts`
- `judgeConfigSchema` — `packages/core/src/schemas/judge-config.ts`
- `advancedResultSchema` + `advancedConfigSchema` — `packages/core/src/schemas/advanced-mode.ts`
- `adjustmentRuleSchema` — `packages/core/src/schemas/assessment-adjustments.ts`
- `ProblemWorkspaceFile` table — `packages/db/prisma/schema/problem.prisma`

## Payload and failure contracts

Worker and runner import the same Zod output schemas from `@nojv/core`; types are
inferred from those schemas, and parsing failures preserve field paths and reasons.
Docker and Kubernetes use flat testcase payload files. A `run-case` process reads
only its requested testcase input; unused grading metadata is not sent to the runner.
Checker and interactor language each travel with their own script. Missing required
language or malformed persisted configuration is an integrity failure, never a
request to select another language or judge mode.

Standard and sample scoring validate expected testcase count and distinct,
zero-based indices before aggregation. Subtask results match cases by index,
regardless of arrival order. Missing, duplicate, or out-of-range cases cannot
produce Accepted. Advanced results retain their separate scoring contract.
Checker results must also match the requested index set exactly once before the
worker constructs its outcome map, so conflicting duplicate outcomes cannot
overwrite an earlier failure.

## Related docs

- [Architecture Overview](./ARCHITECTURE.md)
- [Database Schema](./DATABASE.md)

Assignment and exam allocations are applied after effective raw scoring, outside judging. Changing allocations does not rejudge submissions; see [activity grading](../specs/assignments.md#activity-allocation-and-official-scores).
