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

The **effective** per-run time budget is `timeLimitMs × LANGUAGE_TIME_FACTOR[language]` (`packages/core/src/judge/time-factor.ts`), applied once where the sandbox request is built (`apps/worker/src/activities/judge.ts`). Compiled-native languages (c/cpp/rust) use factor 1.0; slower runtimes get a multiplier (go 1.5, js/ts/java 2, python 3) so the same problem is fair across languages, mirroring DOMjudge's per-language `time_factor`. Because every downstream ceiling (CPU soft TLE, CPU rlimit, wall-clock grace, docker/k8s deadlines, validator timeout) derives from this `timeoutMs`, they all scale together. The factor does not apply to Advanced Mode. Memory has no per-language factor (neither does DOMjudge).

All Standard Mode containers run with `--network none`, `--cap-drop ALL`, `--security-opt no-new-privileges`, a read-only rootfs, and bounded `tmpfs` mounts on `/tmp` (64m) and `/workspace` (128m).

### check

Per-testcase verdict. The strategy is chosen by `judgeConfig.type`. The crucial
fairness invariant for the non-standard strategies is **run/check separation**:
the container that runs untrusted student code never mounts the expected answers
or the validator source. Only the worker (or a second isolated container that
holds no student code) makes the AC/WA decision.

- **`standard`** — token-based comparison matching the DOMjudge/ICPC default output validator, in `packages/core/src/judge/compare.ts` (`compareStandard`). Both sides are split on any run of whitespace (spaces, tabs, **and newlines**), and the resulting token lists must match element-for-element. Whitespace amount and line structure are therefore always irrelevant (`"1 2"` = `"1  2"` = `"1\n2"`); this is hard-wired and not configurable. Two per-problem knobs, set by the problem author and stored in `judgeConfig.compare`, refine token matching:
  - `caseSensitive` (default `true`) — when `false`, tokens compare case-insensitively. Note: NOJV defaults to **strict** case matching, the opposite of DOMjudge's default validator (case-insensitive); authors who want DOMjudge-equivalent leniency must set this `false` per problem.
  - `floatTolerance` (default unset = exact) — when set to ε, two numeric tokens match if they are within absolute **or** relative error ε (the DOMjudge `float_tolerance` shorthand). Non-numeric tokens always compare exactly.

  The run container only emits each case's raw stdout/stderr/exit (`rawRuns`); the worker performs the comparison against the answer it holds, so `judgeConfig.compare` only needs to reach the worker. Anything token comparison cannot express (multiple valid answers, structural checks, etc.) must be implemented as a **checker**.

- **`checker`** — a teacher-provided **DOMjudge output validator** (`python` / `cpp`) that renders an **AC/WA verdict only** (no partial scoring). The run container produces `rawRuns` (no answer present); the worker then launches a **second isolated validator container** (`validator-executor.ts` → sandbox-runner `runValidate`) per clean case. The validator is invoked as `validator <input> <judge_answer> <feedback_dir>` with the team output on stdin and must **exit 42 (accept) or 43 (wrong)**; any other exit is treated as a validator/system error. Feedback travels through files in `feedback_dir`: `teammessage.txt` (shown to the student) and an optional `judgemessage.txt` (operator-only). Python TAs get a wrapper binding `judge_input` / `judge_answer` / `team_output` plus `accept()` / `wrong()` / `judge_log()` (`apps/sandbox-runner/assets/wrappers/python-validator.py`); C++ TAs implement the bare interface.
- **`interactive`** — a teacher-provided **DOMjudge interactor**, run as **two isolated containers** wired by a worker byte proxy (`interactive-executor.ts` → sandbox-runner `runInteractive`): the solution container runs student code with its stdio bridged to the interactor container, and the secret input/answer is mounted only into the interactor side. The interactor uses the same exit-42/43 + `feedback_dir` protocol as the validator, but its Python wrapper exposes live `read()` / `write()` instead of a fixed `team_output` blob (`apps/sandbox-runner/assets/wrappers/python-interactor-domjudge.py`).

On K8s, `checker` runs as a **two-Job pipeline**: the run Job's ConfigMap omits both the expected answer and the validator script; a second `judge-<sub>-validate` Job (separate ConfigMap, identical hardening, NO student source) compiles the validator and grades the captured team outputs against the answers, and the worker merges the outcomes via `mergeCheckerResults` (same merge as Docker). Per-case files reach the validate pod via flat keys (`case-{i}-{input,answer,team}.txt`) because ConfigMaps cannot hold nested directories. `interactive` **also runs on K8s** (`K8sExecutor.executeInteractive` → `runInteractiveCase`): one Job per testcase with two containers (solution + interactor) wired over a `socat` TCP bridge on port 7777, the secret input/answer mounted only into the interactor side. Only **tarball-source `advanced`** stays Docker-backend-only (the cluster cannot `docker load` a TA-supplied tarball); **registry-source `advanced`** runs as a K8s Job. See [backends](#sandbox-verdicts) and `k8s-executor.ts`.

### score

Subtask scoring is **all-or-nothing**: a `TestcaseSet` (subtask) earns its full `weight` only if **every** case in it is AC, otherwise 0. There is no per-subtask strategy column and no per-case partial credit — checkers/interactors render AC/WA only. This is uniform across practice, assignment, contest, and exam; contests adjust whole-**problem** aggregation (see [Architecture](./ARCHITECTURE.md)), not the subtask AC-all decision.

The final 0–100 score is `round((Σ rawScore / Σ weight) * 100)`, where each subtask's `rawScore` is `weight` (all cases AC) or `0`. This happens in `buildSubtaskResults()` and `mapResult()` inside `packages/application/src/submission/scoring.ts`. The raw score then goes through the post-judge adjustment step (see [Adjustment rules](#adjustment-rules)).

### Judge-type parity note

A Phase 5 parity audit confirmed that `standard`, `checker`, and `interactive` already implement run/check separation: the answers and any judge code live **only** in the worker process or a no-student container/ConfigMap (the second validator container / interactor side, or the K8s `validate` Job's ConfigMap), never alongside untrusted student code. They therefore do **not** share Advanced Mode's new run/grade attack surface, and were intentionally left unchanged by the run/grade redesign. Across **all** judge types — standard, checker, interactive, and advanced — rejudge reads **live** problem state by design; no judge type pins a config snapshot.

## Advanced Mode pipeline

Advanced Mode is the escape hatch for problems that need custom toolchains, binary I/O, a controlled public-API call, or anything else Standard Mode can't express. Unlike Standard Mode, the platform does not compile/execute the student itself — but it **does** own the topology and the student-side hardening. The model is a **run/grade two-phase split** that reuses the same `run/check separation` invariant as `checker`/`interactive`: the container that runs untrusted student code never holds the answers, and only a separate, time-separated container with no student code makes the grading decision. Full rationale (and the rejected alternatives) lives in the design doc: [Advanced Judge run/grade split](../plans/active/2026-06-14-advanced-judge-run-grade-split-design.md).

### Run/grade two-phase split

Per submission the worker orchestrates two **time-separated** phases plus, optionally, one network sidecar — all ephemeral (fresh per submission, destroyed in `finally`):

1. **run phase** — a **run container** (untrusted: holds the student code, hardened, runs as uid `10001`) plus at most one network sidecar. It reads its baked-in testcase **inputs**, runs the student program, and writes per-case outputs + a status marker into `/workspace/output/`. It holds **no answers**.
2. **capture** — after the run container exits, the platform captures `/workspace/output/` host-side via `safeCopyTree` (the answer-leak gate, below) into the grade workspace. The worker derives a `runStatus` from how the run container ended.
3. **teardown** — run container + sidecar + per-submission networks are removed.
4. **grade phase** — a **grade container** (trusted TA, holds the baked-in answers in its image rootfs, full network, **no student code**) mounts the captured run output read-only at `/workspace/run-output` plus a `meta.json` carrying `runStatus`, and writes `/workspace/output/result.json`.

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

The grade harness owns grading: `score` (0–100) is authoritative; per-case detail flows through `testcases[]` (advanced problems have no platform testcase sets). A `compile_error` verdict is surfaced as a compile failure (score 0), matching standard mode.

### Verdict ownership and System Errors

The worker funnels every run outcome through `runStatus` and **always proceeds to grade** after a run that did not _infrastructurally_ fail — including an **empty `/output`** (a student that printed nothing is a legitimate WA/RE for the grade harness to render, not a platform fault). The worker raises a **System Error** (`advancedFallbackResult`, every testcase → `SE`) only on infrastructure failures: run/grade container **spawn** error, run/output **size-cap exceeded** (`safeCopyTree` `SafeCopyLimitError`, or the during-run watchdog), grade **timeout**, and a missing/unreadable/malformed `result.json`. On K8s the same set applies plus the **transfer-sidecar non-zero exit** (a capture-gate or IO failure inside the run Pod → SE, grade never created). In `allowlist` mode a proxy denial reaches the student program as an ordinary connection error — **not** an SE.

### `advancedConfig` (image sources + network policy)

The TA configures the problem via the `Problem.advancedConfig` JSON column (`advancedConfigSchema`), holding per-role images and a network policy:

```jsonc
advancedConfig: {
  run:   { imageRef, imageSource: "registry" | "tarball" },
  grade: { imageRef, imageSource: "registry" | "tarball" },
  network: {
    mode: "none" | "allowlist" | "service",   // default "none"
    allowlist?: string[],                       // mode = "allowlist", e.g. ["api.example.com:443"]
    service?: { imageRef, imageSource }         // mode = "service"
  }
}
```

`imageRef` is either a registry reference (`ghcr.io/org/judge:tag`) or a storage key pointing at a tarball. `special_env` validation (`packages/core/src/schemas/problem.ts`) requires both `run` and `grade`, a non-empty `allowlist` iff `mode = "allowlist"`, and a `service` image iff `mode = "service"`. For `tarball` sources the worker streams the tarball out of object storage and `docker load`s it on first use, caching the loaded ref per storage key for the worker's lifetime; **tarball is Docker-only** (see backends). `advancedRequiredPaths` (a separate optional `Problem` column) still governs the student **upload** shape — the set of relative paths a submission ZIP must contain — and is unrelated to `advancedConfig`.

### Network modes

The run container is always **single-homed with no direct internet route** and can reach **at most one** sidecar:

| mode             | run reaches                                 | extra container | use                                       |
| ---------------- | ------------------------------------------- | --------------- | ----------------------------------------- |
| `none` (default) | nothing                                     | —               | offline judging                           |
| `allowlist`      | platform egress-proxy → listed public hosts | egress-proxy    | "call this public API"; TA writes no code |
| `service`        | TA service container (full net)             | service         | student talks to a mock/DB/simulator      |

- **`allowlist`** — the worker starts a platform **egress-proxy** sidecar (`infra/docker/egress-proxy/proxy.mjs`) that enforces a per-problem hostname allowlist on the HTTP `CONNECT` request-line host:port (HTTPS) or proxied Host (plain HTTP) before opening the tunnel; everything else → `403` + audit log, **no TLS interception**. The worker injects `HTTP_PROXY`/`HTTPS_PROXY` (and lowercase variants) into the run container pointing at the proxy **by IP** with an empty `NO_PROXY`, so the run container needs no DNS of its own (outbound DNS resolution happens in the proxy). The run container cannot escape by unsetting the proxy vars or hard-coding a public IP: with no internet route it has nowhere to go but the proxy.
- **`service`** — a TA-provided dependency (mock API / DB / simulator, full network, trusted). The run container reaches it at `NOJV_SERVICE_HOST=host:8888` over the internal network.

### Backends

Both the Docker backend (local/dev) and the Kubernetes backend (GKE prod) are supported; no backend is abandoned.

**Docker** (`advanced-mode-executor.ts` + `docker-network.ts` + `egress-proxy.ts` + `service-container.ts`). `none` → `--network none`. `allowlist`/`service` create a per-submission pair of networks: `net_internal` (a `--internal` user-defined network with zero external routing) that `run` and the sidecar's first NIC attach to, and `net_egress` (a NAT bridge) that **only** the sidecar's second NIC attaches to — so only the sidecar egresses, and run, being single-homed on `net_internal`, has no route to the internet even if it hard-codes a public IP. The sidecar is a separate container (never sharing run's netns). Networks are created per submission and torn down on the `finally` path.

**Kubernetes** (`k8s-executor.ts` + `k8s-advanced.ts` + `k8s-advanced-network.ts`). Run and grade are **two separate Jobs**; run output crosses between them over a per-submission **`ReadWriteOnce` PVC** (lossless binary, no ConfigMap 1 MB limit). A native `transfer` sidecar in the run Pod runs the **same `safeCopyTree` gate** on TERM, copying `/output` → PVC; the grade Pod mounts the PVC read-only and is pinned (`spec.nodeName`) to the run Pod's node because RWO is single-node. Because all containers in one Pod share a netns, the egress sidecar **must** live in a **separate Pod** (this is the one place Advanced differs from `interactive`, which can co-locate over `127.0.0.1`). Egress isolation is per-submission `NetworkPolicy`:

- The blanket deny-all (`infra/k8s/sandbox/network-policy.yaml`, `infra/gcp/gke/network-policy.yaml`) selects on `nojv.egress` **`DoesNotExist`**, so standard/checker/interactive Pods and `mode=none` advanced run Pods (none carry the label) stay denied. The run Pod (allowlist/service) is relabeled `nojv.egress=<id>` and gets `buildRunEgressPolicy` allowing egress **only** to the sidecar Pod (no `0.0.0.0/0`, no `ipBlock`, no kube-dns) with `ingress: []` (the untrusted run Pod is never a server). The grade Pod is labeled `nojv.egress=<id>-grade` and gets full egress (`buildGradeEgressPolicy`) in **every** mode. The sidecar Pod gets full egress + ingress only from the run Pod (`buildSidecarEgressPolicy`), is fronted by a per-submission ClusterIP Service, and the run Pod's `HTTP_PROXY` / `NOJV_SERVICE_HOST` is injected by that **ClusterIP literal** (never a DNS name, preserving the no-DNS-in-the-run-Pod invariant). The worker is granted `pods`/`services`/`networkpolicies`/`persistentvolumeclaims` in `infra/gcp/gke/worker-rbac.yaml`.
- **CNI enforcement is a hard dependency.** Every NetworkPolicy above is a **no-op** unless the cluster's CNI actually enforces NetworkPolicy (GKE Dataplane V2 / Cilium / Calico). A non-enforcing CNI (kindnet/flannel, some managed defaults) installs the API objects but lets the run Pod reach the whole internet while every policy "exists" — and the happy-path AC test still passes. This is why the [Phase 8 smoke runbook](../plans/active/2026-06-14-advanced-judge-run-grade-split-design.md#phase-8-smoke-verification-runbook) must affirmatively assert egress is **blocked**, not merely that an allowlisted call succeeds.

**Tarball-source advanced images require the Docker executor.** `K8sExecutor.executeAdvanced` short-circuits a tarball-source run **or** grade with an `SE` (the learner sees a neutral message; the operator reason is logged at `error`) because the cluster cannot `docker load` a TA tarball — push to a registry the cluster can pull instead. The same applies to a tarball `service` image.

### Hardening posture

| flag                | run (untrusted)            | grade / service (trusted) | egress-proxy                  |
| ------------------- | -------------------------- | ------------------------- | ----------------------------- |
| `--cap-drop ALL`    | yes                        | yes                       | yes                           |
| `no-new-privileges` | yes                        | yes                       | yes                           |
| `--read-only`       | yes                        | yes                       | yes                           |
| `--user` non-root   | **yes (10001)**            | no (TA-managed, as today) | yes                           |
| network             | only its sidecar (or none) | full                      | internal-in + allowlisted-out |
| holds answers       | **never**                  | grade: yes (baked)        | never                         |

All four roles share `--cap-drop ALL`, `no-new-privileges`, `--read-only` rootfs, and the `--memory` (+ matching `--memory-swap`) / `--cpus` / `--pids-limit` bounds; on K8s the equivalent `securityContext` (`runAsNonRoot`, `allowPrivilegeEscalation: false`, `seccompProfile: RuntimeDefault`, resource limits). The run container additionally runs as uid `10001` — the only role running untrusted code; grade/service keep the existing trusted-TA "no `--user`" posture (a malicious TA `service` can at worst abuse the network, never reach the answers). Writes are permitted only to `/tmp` (a 64m `tmpfs`) and `/workspace` (the host bind / emptyDir). The `/workspace` mount has no `tmpfs` size cap; instead a watchdog polls every 2 s and force-kills the container if the directory exceeds **1 GiB** or **100k files** (extended from byte-sum to also count files, so a million 1-byte files can't be written) → SE. Resource limits reuse `Problem.timeLimitMs` / `memoryLimitMb` (100 ms–30 s, 16–1024 MB) as `advanced.totalTimeMs` / `advanced.memoryMb`; the outer container kill timeout is `totalTimeMs + 30 s` per phase. Advanced Mode skips the in-browser editor: students submit a ZIP (or a single source file the platform wraps into `sourceFiles: [{ path, content }]`).

### Capture safety (the answer-leak gate)

`/output` is written by untrusted student code, so the host-side capture is the security-critical step. `safeCopyTree` walks the run container's static, post-exit `/output` and, per entry, `lstat`s **before** any `isFile`/`isDirectory` branch:

- **Skips every symlink** (the core gate, never copied and never dereferenced). A malicious `output/x → /answers/secret` (absolute) or `→ ../escape` (relative) therefore never reaches `grade/run-output`, so nothing can resolve against the grade container's baked-in `/answers`. Because no symlink is ever dereferenced, the capture can't be tricked into reading host secrets either.
- **Skips special files** (FIFOs, sockets, device nodes) without `open()`ing them, so a FIFO can't hang the capture.
- **Copies regular files as raw bytes** (binary-safe), throwing `SafeCopyLimitError` (→ SE) past 100k files or 1 GiB.

It is host-side rather than an in-container `tar --dereference` because the run container is `--rm` and gone the instant its main process exits — and keeping the gate in platform (not TA) code means it is unit-tested without Docker, with no TOCTOU window against the dead container's static bytes. The K8s `transfer` sidecar runs a byte-identical embedded copy of this gate inside the answer-free run Pod (cross-gate parity locked by test).

### Authoring run/grade judge images

TAs don't hand-write the boilerplate. The problem edit page (Advanced settings → Container contract) has **Download starter project** buttons that stream per-role self-contained zips via `GET /api/problems/advanced-scaffold?role=run|grade|service` (auth-gated, zipped from `apps/web/src/lib/server/advanced-scaffold/files/{run,grade,service}/` on the fly with JSZip):

- **run** — `runner.py` (load `meta.json`, compile/run the student per case, write `/output`) + a `Dockerfile` baking testcase **inputs**.
- **grade** — `grader.py` (read `/run-output` + the baked-in `/answers`, decide verdicts, write `result.json`) + a shared stdlib-only `nojv_grader.py` helper (validate/normalize verdicts, `write_result`) the TA does **not** edit + a `Dockerfile` baking the **answers**.
- **service** — a minimal HTTP service example listening on `PORT` (8888).

Workflow: **download the scaffolds → edit `runner.py` / `grader.py` (+ testcases/answers) → `docker build` each → upload** (per-role, either a `docker save | gzip` tarball or a registry reference). The canonical `result.json` verdicts are the long forms at the top level and the short codes (`AC`/`WA`/`TLE`/`MLE`/`RE`/`SE`) per testcase — `write_result` accepts either and normalizes.

Because answers live **only** in the grade image and student code **only** in the run container, answer protection is now a **platform guarantee** rather than TA discipline: a malicious submission cannot read the answers (they are in a different, time-separated container), reach the grade container, or leak an answer through a `/output` symlink. SNI / domain-fronting protection in `allowlist` mode is a documented **future hardening** (not implemented) — it is not load-bearing because the run container holds no secrets, so a domain-fronting student has nothing to exfiltrate (see the design doc's egress-proxy section).

### `advancedConfigSnapshot` (audit, not a judging input)

`Submission.advancedConfigSnapshot` (`Json?`) is a pure **audit record** written at judge completion — _which_ `advancedConfig` graded this submission (overwritten on every judge/rejudge; null for non-advanced). It is **never** read back into judging. **Rejudge reads the LIVE `Problem.advancedConfig`** (via `getJudgeContext` → `parseAdvancedConfig`), consistent with every other judge type — a teacher who fixes a broken run/grade image and rejudges gets the **new** image, never a pinned snapshot.

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
- Advanced Mode run/grade executor (Docker) — `apps/worker/src/services/advanced-mode-executor.ts` (`safeCopyTree` answer-leak gate, `deriveRunStatus`, network-mode branch)
- Advanced Mode Docker networking + sidecars (Docker) — `apps/worker/src/services/docker-network.ts`, `egress-proxy.ts`, `service-container.ts`
- Advanced Mode K8s manifests (two Jobs + PVC + transfer gate) — `apps/worker/src/services/k8s-advanced.ts`
- Advanced Mode K8s networking (per-submission NetworkPolicies + sidecar Pod/Service) — `apps/worker/src/services/k8s-advanced-network.ts`
- Egress-proxy image (allowlist enforcer) — `infra/docker/egress-proxy/proxy.mjs`
- Kubernetes executor (Standard + checker via two-Job pipeline, interactive via per-case two-container Job, registry-source advanced via two Jobs + PVC; rejects only tarball-source advanced) — `apps/worker/src/services/k8s-executor.ts`
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
- `advancedResultSchema` + `advancedConfigSchema` — `packages/core/src/schemas/advanced-mode.ts`
- `adjustmentRuleSchema` — `packages/core/src/schemas/assessment-adjustments.ts`
- `ProblemWorkspaceFile` table — `packages/db/prisma/schema/problem.prisma`

## Related docs

- [Architecture Overview](./ARCHITECTURE.md)
- [Database Schema](./DATABASE.md)
