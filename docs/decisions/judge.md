# Judge and sandbox decisions

Durable decisions for submission judging, verdicts and scoring, the judge queue, browser Test, Advanced Mode and sandbox isolation. Read the relevant entries before planning a change here; a change that contradicts an entry must say so and update or replace the entry in the same PR. Current mechanics live in [Judge Pipeline](../architecture/JUDGE_PIPELINE.md) and [Security Requirements](../operations/SECURITY.md).

### JDG-01 Fixed Standard Mode with three exclusive judge types

**Decided:** 2026-04 · **Source:** [2026-04-02-judge-pipeline-spec](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-02-judge-pipeline-spec.md), [2026-04-03-problem-config-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-03-problem-config-redesign.md), [2026-04-09-problem-ui-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-09-problem-ui-redesign.md)

The Standard Mode pipeline is implicit and fixed, not a list of configurable stages. The judge type is exactly one of `standard`, `checker` or `interactive`; anything these cannot express goes to Advanced Mode (`special_env`, JDG-16), not to new Standard settings. TAs do not think in pipelines, and no amount of settings would cover custom environments.

- Rejected: pipeline/stage-card editor; per-problem static analysis, artifact collection, network access, custom stage scripts and custom scoring scripts (the 2026-04-02/04-03 extensible pipeline); judge types as pipeline steps.
- Rule: `judgeConfig` holds only type, checker/interactor language, `compare` and `runtime`; do not add stage arrays, static-analysis, artifact, network or custom-script settings.
- Code: `packages/core/src/schemas/judge-config.ts`, `packages/core/src/types.ts`

### JDG-02 Standard compare is DOMjudge token comparison with two knobs

**Decided:** 2026-06 · **Source:** [2026-04-13-judge-config-simplification-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-13-judge-config-simplification-design.md), [2026-06-13-domjudge-alignment](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-13-domjudge-alignment.md), [2026-06-13-domjudge-alignment-followup](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-13-domjudge-alignment-followup.md)

`standard` always tokenizes on ASCII whitespace (not configurable); `judgeConfig.compare.caseSensitive` defaults to `true` (opposite of DOMjudge, by explicit user choice) and `floatTolerance` is opt-in, absolute OR relative. Mature OJs do not expose compare modes, and a mode picker suggested it could replace writing a checker.

- Rejected: the five-mode dropdown (exact, ignore_whitespace, ignore_case, float, regex, removed 2026-04); line-based `normalize()`; `spaceChangeSensitive`; flipping the case default; passing validator flags to checkers/interactors; Codeforces-style byte-exact compare.
- Rule: `compare.ts` is the single source of comparison semantics, shared by the stage judge container and browser Test; compare runs in the judge container, never where student code runs.
- Rule: no compare-mode or regex option; anything token comparison cannot express needs a checker.
- Code: `packages/core/src/judge/compare.ts`, `packages/core/src/schemas/judge-config.ts`

### JDG-03 DOMjudge validator protocol for checkers and interactors, AC/WA only

**Decided:** 2026-05 · **Source:** [2026-04-13-judge-config-simplification-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-13-judge-config-simplification-design.md), [2026-05-28-judge-isolation-domjudge-validator](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-28-judge-isolation-domjudge-validator.md), [2026-06-13-domjudge-alignment](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-13-domjudge-alignment.md)

Checkers and interactors are written in `python` or `cpp` only and follow the DOMjudge/Kattis protocol: `validator <input> <answer> <feedback_dir>`, team output on stdin, exit 42 = AC, 43 = WA, anything else = SE; `teammessage.txt` reaches students, `judgemessage.txt` is staff-only. The product owner chose DOMjudge for standards compliance; undocumented argv/exit protocols forced boilerplate.

- Rejected: testlib (bundled or forked; removed entirely); DMOJ-style `process_output`/partial wrapper; `score.txt` partial credit (removed 2026-06); bash/node/C checkers; a presentation-error verdict.
- Rule: verdicts stay AC/WA/TLE/MLE/RE/CE/SE; PE will not be added.
- Rule: protocol changes are hard breaks; existing validators are re-authored, never auto-translated.
- Code: `packages/core/src/judge/validator.ts`, `apps/sandbox-runner/assets/wrappers/`

### JDG-04 Subtasks score all-or-nothing in every context

**Decided:** 2026-06 · **Source:** [2026-04-13-judge-config-simplification-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-13-judge-config-simplification-design.md), [2026-05-16-analytics-virtual-contest-upsolve](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-16-analytics-virtual-contest-upsolve.md), [2026-06-13-domjudge-alignment](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-13-domjudge-alignment.md)

A TestcaseSet earns its full weight only if every case is AC, else 0, in practice, assignment, contest and exam alike; there is no per-subtask strategy and no per-case partial credit. Product decision while aligning with DOMjudge; contest modes aggregate only at the problem level.

- Rejected: per-case partial credit from validators. Earlier: per-subtask `all_or_nothing` / `proportional` / `minimum` strategies in `judgeConfig.scoring.subtaskStrategies` (2026-04), then a `TestcaseSet.scoringStrategy` enum (`SubtaskScoringStrategy`, PROPORTIONAL/MINIMUM) with real MINIMUM semantics (2026-05) — both removed.
- Rule: no per-subtask strategy column; complex grading uses a checker (AC/WA) or Advanced Mode; adding partial or strategy scoring means revisiting [Judge Pipeline](../architecture/JUDGE_PIPELINE.md).
- Rule: no subtask early exit; students see every case's result.
- Code: `packages/application/src/submission/scoring.ts`

### JDG-05 Run/check separation: untrusted code never sees answers or validators

**Decided:** 2026-05 · **Source:** [2026-04-02-judge-pipeline-spec](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-02-judge-pipeline-spec.md), [2026-05-28-judge-isolation-domjudge-validator](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-28-judge-isolation-domjudge-validator.md), [2026-09-23-judge-single-sandbox-per-stage](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-09-23-judge-single-sandbox-per-stage.md)

The container that runs student code never mounts expected answers, validator/interactor source or secret interactor input; checking happens in a separate container that starts only after the run container exits (interactive pairs a solution side with an interactor side that alone holds the secret data). A shared mount namespace once let programs read `expected.txt` and always get AC. Isolation must need no extra privileges and work on Docker and K8s.

- Rejected: in-container namespaces/unshare (blocked by cap-drop/no-new-privileges; user namespaces unreliable on GKE); privileged supervisors (isolate, nsjail); starting the judge container alongside run; earlier worker-side comparison and separate validator Jobs.
- Rule: no student process may be alive while answers exist in the Pod; output hashes are verified before comparison.
- Rule: unit tests pin the no-leak property of run payloads.
- Code: `apps/sandbox-runner/src/judges/run-stage.ts`, `apps/sandbox-runner/src/judges/judge-stage.ts`, `apps/worker/src/sandbox/kubernetes/job-manifests.ts`

### JDG-06 One sandbox per stage; per-process accounting via nojv-exec

**Decided:** 2026-09 · **Source:** [2026-09-23-judge-single-sandbox-per-stage](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-09-23-judge-single-sandbox-per-stage.md), [2026-06-12-full-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-12-full-audit-remediation.md), [2026-06-13-domjudge-alignment-followup](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-13-domjudge-alignment-followup.md), [2026-07-07-system-health-check-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-07-system-health-check-remediation.md)

Each stage of up to `JUDGE_STAGE_CASES` (100; interactive 20) cases runs in one Pod: a run container compiles once and runs cases through the static helper `nojv-exec` (rlimits, subreaper, `wait4` CPU and peak RSS, summed-RSS kill), then the judge container. TLE uses the program's own CPU time; MLE is decided post-hoc from measured peak RSS including children. Per-case containers cost ~9 s of kubelet starts per stage and billed runner overhead to students; gVisor lacks `memory.peak`.

- Rejected: 50 ms `/proc` VmHWM polling (missed forked children); shared-container or per-case-container cgroup `memory.peak` (includes runner, cannot be reset under cap-drop; per-case containers shipped 2026-06/PR #149 then replaced); container wall-clock TLE; sibling-container waves (N x 500m broke the 4-CPU quota above 8 cases); DOMjudge runguard, DMOJ cptbox, Judge0 privileged containers, Firecracker/Kata; warm pod pool (revisit later).
- Rule: students are charged only for their own processes; wall clock is only a 2x watchdog.
- Rule: a case never sees state left by an earlier case. The run container has one uid and no capabilities, so the runner empties scratch space and fingerprints runner-owned files (ctime catches rewrites even when mtime is restored) around each case, and `nojv-exec` denies SysV IPC and POSIX message queues by seccomp; tampering is RE for the rest of the stage. Rejected: a separate uid (needs CAP_SETUID, forbidden by the restricted profile), Landlock (not in gVisor), content hashing (up to 64 MiB per case).
- Rule: Pod requests must fit the sandbox ResourceQuota whatever the case count; a stage reserves `K8S_RUN_PARALLELISM` CPUs and the container memory limit covers P x (case limit + headroom) + runner.
- Rule: stage ranges are a pure function of the execution snapshot (`judgeStageRanges`); a stage is cut early so its worst-case deadline stays under the 1,800 s Job cap and its testcase data under 64 MiB. Stage size rose from 20 to 100 in 2026-09 because every extra stage repeats a Job start, compile and cleanup (about 5 s, plus 3.5 s for C++); cases already shared the Pod, so isolation is unchanged.
- Rule: before changing stage ranges, check that no execution has saved stages but is not finished; an in-flight execution would be re-sliced mid-way.
- Code: `apps/sandbox-runner/native/nojv-exec.c`, `packages/core/src/judge-execution.ts`, `apps/worker/src/env.ts`

### JDG-07 Per-language time factor applied once

**Decided:** 2026-06 · **Source:** [2026-06-13-domjudge-alignment-followup](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-13-domjudge-alignment-followup.md)

Effective time limit is `timeLimitMs x LANGUAGE_TIME_FACTOR[language]` (c/cpp/rust 1, go 1.5, js/ts/java 2, python 3), applied once where the worker builds the sandbox request; every downstream ceiling derives from it. Mirrors DOMjudge `time_factor` for cross-language fairness.

- Rejected: applying it in `getJudgeContext` (no language, pollutes the displayed base); a memory factor; per-problem overrides (deferred); applying it to Advanced Mode.
- Rule: keep the factor as a global const map in core; never multiply elsewhere.
- Code: `packages/core/src/judge/time-factor.ts`, `apps/worker/src/activities/judge-request.ts`

### JDG-08 Memory ceiling above the problem limit; admission rejections fail fast

**Decided:** 2026-08 · **Source:** [2026-08-14-judge-admission-and-memory](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-08-14-judge-admission-and-memory.md)

Authoring max stays 1024 MB; the container hard limit is the problem limit plus 64 MB headroom, capped by a 1536Mi platform/LimitRange ceiling, so the measured peak decides MLE before the kernel kills. A Job `FailedCreate` admission rejection raises `SandboxAdmissionError`, which moves the execution straight to `blocked` (shown as SE, retried every 15 min by reconciliation) instead of waiting out Job deadlines; capacity/scheduling backpressure stays a normal retry. A 1024 MB problem once exceeded a 1Gi LimitRange and the worker waited out deadlines, blocking every judge slot.

- Rejected: raising authoring limits or node capacity; changing worker concurrency or quota to fix it.
- Rule: deterministic admission failures never hold a judge slot; they block the execution and surface as SE. Backpressure is retryable.
- Code: `packages/core/src/sandbox.ts`, `apps/worker/src/sandbox/kubernetes/admission.ts`, `infra/charts/nojv/values.yaml`

### JDG-09 Platform failures are system_error, explicit and bounded

**Decided:** 2026-06 · **Source:** [2026-06-10-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-10-audit-remediation.md), [2026-08-11-single-machine-throughput-tuning](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-08-11-single-machine-throughput-tuning.md), [2026-09-05-architecture-simplification](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-09-05-architecture-simplification.md), [2026-08-21-ui-and-reliability-fixes](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-08-21-ui-and-reliability-fixes.md)

Any case SE makes the submission `system_error`: score 0, not scored, no attempt consumed. Judging uses one validated sandbox output contract; missing, duplicate or out-of-range case results and corrupt persisted config fail with operator diagnostics. Output/feedback is truncated with a marker before schema parsing, and `mapResult` shares one 256,000-byte diagnostic budget across cases to stay under Temporal's 4 MiB payload limit. SE once mapped to runtime_error and silent failures hid judging corruption.

- Rule: keep student errors and platform errors separate in verdicts and UI colors.
- Rule: naming a missing entry file fails, never falls back to the default source; platform-failure diagnostics come before completeness checks.
- Rule: infrastructure failures retry durably and never become a final student verdict.
- Code: `packages/application/src/submission/scoring.ts`

### JDG-10 Durable execution snapshots; rejudge in place with audit log

**Decided:** 2026-06 · **Source:** [2026-04-19-rejudge-and-score-override-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-19-rejudge-and-score-override-design.md), [2026-04-19-rejudge-and-score-override-plan](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-19-rejudge-and-score-override-plan.md), [2026-06-14-advanced-judge-run-grade-split-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-14-advanced-judge-run-grade-split-design.md)

Each execution captures an immutable problem snapshot at dispatch; automatic recovery reuses it. Revised 2026-09-29 ([#588](https://github.com/NOJV-TW/NOJV/pull/588), [#590](https://github.com/NOJV-TW/NOJV/pull/590), [#591](https://github.com/NOJV-TW/NOJV/pull/591)): the snapshot pins testcase object pointers, recorded in `JudgeExecutionObject` so cleanup keeps them while the execution exists, instead of embedding contents; embedding raised web RSS about 6.6× the testcase bytes per submission (a 512Mi web pod was OOMKilled) and stored a full copy per submission (3.3 GB over 947 executions). Existing copies are compacted by `compact-judge-snapshots`. A teacher rejudge (`single` or filtered `batch`) pins the latest effective problem version (including Advanced images) when accepted, keeps the old result visible until the new one commits, overwrites the Submission after a `SubmissionRejudgeLog` snapshot, and runs the normal post-judge path. Teachers expect rejudge to use their fix without resubmission losing timestamps; recovery must be reproducible.

- Rejected: embedding testcase contents in each snapshot (memory and storage above); one shared testcase bundle per problem generation (the first submission after an edit still builds it in web memory, and workers load it whole); building the snapshot in the worker after acceptance (loses the acceptance-time version pin, PRB-15).
- Rejected: pinning rejudge to the original snapshot; forcing students to resubmit; `score_rejudged` student notification. Fire-and-forget rejudge without progress (2026-04) was reversed: `RejudgeProgress` and cancellation exist.
- Rule: every rejudge writes a `SubmissionRejudgeLog` audit row (see PRB-18 in problems.md).
- Rule: a frozen contest scoreboard snapshot is not changed by rejudges or overrides until unfreeze.
- Rule: historical SE records without snapshots cannot be recovered from current problem contents.
- Rule: a pinned object stays as long as the execution that pins it; there is no time-based release, since SE recovery can happen at any time.
- Code: `packages/application/src/submission/judge-execution.ts`, `packages/application/src/submission/rejudge-control.ts`, `packages/db/prisma/schema/submission.prisma`

### JDG-11 SE recovery is bounded and generation-guarded

**Decided:** 2026-07 · **Source:** [2026-07-15-admin-mode-se-recovery](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-15-admin-mode-se-recovery.md), [2026-08-11-single-machine-throughput-tuning](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-08-11-single-machine-throughput-tuning.md)

Sandbox pipeline failures store bounded SE diagnostics for the admin submissions view. Recovery runs only on the platform worker (stale sweep first), with at most one deterministic system rejudge per failed judge generation; the judge worker does no recovery scan. Restart recovery was unbounded and duplicated across workers.

- Rule: recovery must be generation-guarded and idempotent; at most one active judge workflow per submission.
- Code: `packages/application/src/submission/rejudge-control.ts`, `packages/application/src/submission/judge-recovery.ts`, `apps/worker/src/worker-app.ts`

### JDG-12 Judge queue is Temporal priority and fairness, not a coordinator

**Decided:** 2026-09 · **Source:** [2026-09-21-judge-capacity](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-09-21-judge-capacity.md), [2026-09-22-temporal-native-judge-queue](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-09-22-temporal-native-judge-queue.md), [PR #597](https://github.com/NOJV-TW/NOJV/pull/597)

Each `JudgeExecution` runs `durableJudgeWorkflow` on the `judge` queue with `priorityKey` (exam 1, contest 2, practice/assignment 3, recovered submission 4, rejudge 5) and `fairnessKey = studentId`; a student has at most one dispatched non-terminal execution and completion dispatches the next. Capacity is judge worker activity slots, with the sandbox ResourceQuota as hard safety net. A 789-execution rejudge collapsed the workflow-based coordinator.

- Rejected: `judgeAdmissionWorkflow` coordinator with FIFO/permit loops and waves (removed with `JudgeAdmission`, `capacityStrategy`); Kueue (quota-based; revisit only for shared multi-node clusters); HPA/KEDA on one node.
- Rule: self-hosted Temporal needs `matching.enableFairness` and one partition per NOJV queue.
- Rule: stage and bookkeeping activities carry priority; bookkeeping runs on `judge-state` so it never queues behind Jobs; unmapped paths degrade to priority 3.
- Rule: priority derives from origin (`operationId` marks a rejudge, `recoveryEpoch` a recovery), never from `queueClass`, which only orders a student's own executions; recovered live submissions dispatch ahead of bulk rejudges.
- Rule: rollback re-dispatches execution rows via the reconciler; never replay new histories with old worker code.
- Rule: completion and cancellation hand off without waiting for the once-a-minute durable-work cron: they write the next execution's dispatch row, then try the gated start directly. Correctness rests on the row and the workflow ID, never on the direct attempt.
- Code: `packages/core/src/judge-execution.ts`, `packages/application/src/submission/judge-recovery.ts`, `infra/docker/temporal-dynamic-config.yaml`

### JDG-13 Load-aware judge slots follow node load from /proc

**Decided:** 2026-09 · **Source:** [2026-09-22-judge-slot-tuner](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-09-22-judge-slot-tuner.md), [PR #606](https://github.com/NOJV-TW/NOJV/pull/606)

With `WORKER_MIN_CONCURRENCY` set, the judge worker's activity slots come from a custom Temporal slot supplier whose budget, between min and `WORKER_CONCURRENCY`, follows node CPU (`/proc/stat` deltas, target 0.8) and node `MemAvailable` (floor 20% of `MemTotal`), sampled every 2.5 s; fixed mode remains. It grows one slot at most every other sample and only while every budgeted slot runs a stage; over either limit it drops to one below the running count; it never goes under the minimum or revokes a running stage. Judging runs in sandbox Pods, not the worker, so only a node-wide signal sees the load; a fixed count cannot track load, and Kubernetes does not decide how many Jobs start.

- Rejected: Temporal's resource-based tuner (2026-09-22 to 2026-09-30). It measured the worker process and container, not the sandbox Pods doing the work, so under a burst it sat at the ceiling, and its memory target tracked worker RSS rather than node memory.
- Rejected: custom slot supplier on the metrics API (extra dependency and lag); Kueue; HPA/KEDA; env knobs for the targets (constants until a measurement needs one).
- Rule: `/proc` is host-wide only inside a container without LXCFS and only describes the node the worker runs on; node-load slots need one judge replica sharing the node with its sandboxes (the chart refuses `minConcurrency` with more replicas). GKE stays on fixed slots until a multi-node plan.
- Rule: workflow-task slots stay fixed; `judge_wall_clock_timeouts_total` is the contention guard (lower the target or ceiling if it fires).
- Rule: the ceiling times per-stage CPU requests must fit the sandbox quota (the chart guard); single-machine is 2–6 because a standard stage Pod requests one CPU and the quota is 6.
- Code: `apps/worker/src/judge-slot-supplier.ts`, `apps/worker/src/worker-app.ts`, `infra/charts/nojv/values-single-machine.yaml`

### JDG-14 One canonical toolchain manifest with exact pins

**Decided:** 2026-07 · **Source:** [2026-07-19-compiler-environment](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-19-compiler-environment.md), [2026-08-14-judge-toolchain-policy](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-08-14-judge-toolchain-policy.md), [2026-08-22-typescript-standard-judge](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-08-22-typescript-standard-judge.md)

`judge-environment.json` is the single source for Alpine/Node versions, exact APK revisions and compile/run commands; the sandbox Dockerfile, runner, public `/environment` page and DEPLOYMENT.md consume it and `lint:doc-drift` fails on a missing pin. Toolchains are not rolling dependencies. TypeScript compiles with pinned `tsc --strict --noEmitOnError` and runs the emitted JS on Node 24. Reproducible judging and a self-updating environment page.

- Rejected: daily scheduled isolation validation (Alpine index noise; weekly instead).
- Rule: upgrade only for security or compatibility, updating manifest and doc table atomically; never hand-edit the page or table.
- Rule: TypeScript type errors are compile errors.
- Code: `packages/core/src/judge-environment.json`, `scripts/check-doc-drift.mjs`

### JDG-15 Browser Test runs locally in WASM-OJ; official verdicts stay on the server

**Decided:** 2026-09 · **Source:** [2026-08-18-forge-judge-spike-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-08-18-forge-judge-spike-design.md), [2026-08-21-browser-local-run-npm-migration](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-08-21-browser-local-run-npm-migration.md), [2026-09-08-test-submit-parity](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-08-test-submit-parity.md), [2026-09-09-test-reliability](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-09-test-reliability.md)

Standard-mode Test for sample and custom cases runs client-side in all eight languages (a firm requirement to keep cost off the server) using pinned `@wasm-oj/browser` and `@wasm-oj/toolchain-*`, same-origin assets verified by digest, and the shared comparator. It never creates a submission; Submit, checker, interactive and Advanced stay on the server. Exact stdin bytes are preserved on both paths.

- Rejected: server fallback for Test; relaxing CSP (`unsafe-eval`, worker exceptions, relaxed-CSP origin); forking or patching Forge in NOJV; host-clock time; appending LF to stdin; browser-executed official Submit; mapping WASM metrics onto CPU/RSS limits before calibration; the monolithic `@wasm-oj/forge` adapter.
- Rule: generic runtime fixes land upstream and are consumed as pinned releases; keep document CSP at `wasm-unsafe-eval`.
- Rule: browser results are previews on Forge logical time; do not claim resource or toolchain-version equivalence; fix sample data, not engine input.
- Rule: source diagnostics are CE, toolchain/infrastructure faults SE; custom cases without expected output are execution-only.
- Code: `apps/web/src/lib/services/browser-local-run.ts`, `apps/web/package.json`, `apps/web/svelte.config.js`

### JDG-16 Advanced Mode is a platform-orchestrated run/grade split

**Decided:** 2026-06 · **Source:** [2026-04-09-problem-ui-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-09-problem-ui-redesign.md), [2026-05-28-judge-isolation-domjudge-validator](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-28-judge-isolation-domjudge-validator.md), [2026-06-14-advanced-judge-run-grade-split-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-14-advanced-judge-run-grade-split-design.md), [2026-06-14-advanced-judge-run-grade-split-implementation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-14-advanced-judge-run-grade-split-implementation.md)

`special_env` runs a TA run image (student code, no answers, uid 10001, hardened), then a TA grade image that holds answers and never sees student code, linked only by the captured `/workspace/output` mounted read-only; the grade harness writes `result.json` (`advancedResultSchema`). The platform owns topology and hardening; TAs own image content via a downloadable scaffold. Students submit a ZIP; Standard-to-Advanced conversion is one-way. The old single image left answer protection to TA discipline.

- Rejected: more Standard settings; inline Dockerfile editing; TA docker-compose (moves hardening to TA config, breaks K8s); forcing `--user` on TA images without a concrete escape; the earlier "empty `/output` is SE" rule.
- Rule: grade never coexists with student code; run never holds answers; Docker and K8s both stay supported.
- Rule: the grade harness owns the verdict; the worker raises SE only on infrastructure failure (spawn, size cap, grade timeout, missing/invalid `result.json`, transfer-sidecar failure).
- Rule: run output crosses to grade only through the capped, symlink-safe capture gate (see SEC-14 in security.md); per-submission resources are torn down in `finally` and swept as orphans.
- Code: `packages/core/src/schemas/advanced-mode.ts`, `apps/worker/src/sandbox/docker/advanced-mode-executor.ts`, `apps/worker/src/sandbox/kubernetes/advanced-executor.ts`

### JDG-17 Advanced network is none or service; answer-bearing containers have no egress

**Decided:** 2026-07 · **Source:** [2026-06-14-advanced-judge-run-grade-split-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-14-advanced-judge-run-grade-split-design.md), [2026-07-12-special-env-image-ref](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-12-special-env-image-ref.md), [2026-07-13-release-preflight](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-13-release-preflight.md)

Network mode is `none | service`. The run container is single-homed with no internet route and reaches at most one TA service sidecar in a separate netns/Pod by IP literal (no DNS). Grade and service containers have no egress (per-submission deny-all NetworkPolicy on K8s, `--network none` on Docker). A grade container with egress is an answer-exfiltration channel.

- Rejected: `allowlist` mode with a platform HTTP CONNECT egress proxy (2026-06, removed); full-network grade/service containers; co-locating the sidecar in the run Pod (shared netns bypasses egress control).
- Rule: CNI NetworkPolicy enforcement is a hard dependency; smoke tests must prove egress is BLOCKED, not only that AC passes.
- Rule: any future egress mode keeps run single-homed behind a platform-controlled sidecar and never opens grade egress.
- Code: `packages/core/src/schemas/advanced-mode.ts`, `apps/worker/src/sandbox/kubernetes/advanced-network.ts`

### JDG-18 sandbox-runner depends only on core

**Decided:** 2026-04 · **Source:** [2026-04-02-microservice-architecture-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-02-microservice-architecture-redesign.md)

`apps/sandbox-runner` imports only `@nojv/core`, which owns the sandbox contract, and talks JSON over container stdio/logs. The runner can be rewritten in another language without touching other packages.

- Rule: no other `@nojv/*` import in sandbox-runner; the contract lives in `@nojv/core`.
- Code: `apps/sandbox-runner/package.json`, `packages/core/src/sandbox.ts`

### JDG-19 Hardened Docker args come from one builder and one package

**Decided:** 2026-06 · **Source:** [2026-06-12-full-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-12-full-audit-remediation.md), [2026-07-07-system-health-check-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-07-system-health-check-remediation.md)

A single pure builder produces Docker run args, and golden tests assert the full profile (`--memory-swap` = `--memory`, `--network none`, `--cap-drop ALL`, `no-new-privileges`, `--read-only`, uid 10001, `--pids-limit`); security helpers are shared via `@nojv/sandbox-docker` so sample validation and judging cannot drift. Docker's default 2x swap misjudged MLE, and a copied code path missed later hardening.

- Rule: any sandbox arg change goes through the builder and updates the golden test.
- Rule: isolation exploit tests fail loudly (not skip) under `REQUIRE_SANDBOX_IMAGE=1`; verify sandbox changes with a real judging run, not mocks.
- Code: `apps/worker/src/sandbox/docker/args.ts`, `packages/sandbox-docker/src/index.ts`

### JDG-20 Production K8s judging fails closed; infrastructure faults retry

**Decided:** 2026-08 · **Source:** [2026-08-06-secure-low-latency-judge-autoscaling](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-08-06-secure-low-latency-judge-autoscaling.md), [2026-08-07-safe-judge-latency-phase-1](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-08-07-safe-judge-latency-phase-1.md), [2026-07-12-special-env-image-ref](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-12-special-env-image-ref.md), [2026-07-20-security-hardening](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-20-security-hardening.md)

Every production sandbox Pod uses the `gvisor` RuntimeClass in a namespace that enforces the `restricted` Pod Security profile; at startup the worker verifies the RuntimeClass, runs a hardened smoke Pod and a NetworkPolicy enforcement probe, and refuses to start on failure. The judge worker's service account holds only sandbox permissions and the platform worker's only registry-GC permissions, with its token unmounted when the registry is disabled. Eviction, node loss, Spot reclamation and `ImagePullBackOff` are retryable infrastructure failures in a fresh sandbox; OOM, TLE and RE stay verdicts. Completion is observed via resource-versioned Job/Pod watches, not polling. Low latency must not weaken isolation.

- Rejected: treating unpullable images as terminal SE (2026-07; replaced by durable retry of the pinned image); a reusable warm runner across submissions.
- Rule: keep non-root, read-only rootfs, dropped capabilities, no privilege escalation, seccomp, no service-account token, limits and deadlines.
- Rule: retries never substitute another image version.
- Rule: never add update, Secret or cross-namespace access to the `sandbox-job-manager` role; it keeps create/get/list/watch/delete on sandbox resources, plus `patch` on ConfigMaps only, for the testcase cache's state and last-use annotations (JDG-23). Patch adds no power over ConfigMaps beyond the existing create and delete, and every cache and stage payload ConfigMap is immutable.
- Code: `apps/worker/src/sandbox/kubernetes/runtime-probe.ts`, `apps/worker/src/sandbox/kubernetes/netpol-probe.ts`, `apps/worker/src/sandbox/kubernetes/job-watch.ts`, `infra/charts/nojv/templates/namespaces.yaml`, `infra/charts/nojv/templates/worker-rbac.yaml`

### JDG-21 10 MiB testcases via sharded, hash-verified payloads

**Decided:** 2026-07 · **Source:** [2026-07-15-10mb-testcase-payload](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-15-10mb-testcase-payload.md)

The testcase limit is 10 MiB of UTF-8 (`MAX_TESTCASE_FILE_BYTES`). K8s payloads are split into immutable binary ConfigMap shards with a manifest (path, chunks, size, SHA-256); a hardened materializer rebuilds them into an emptyDir before student code starts. Process limits use the per-Pod cgroup PID limit, since host-UID-wide `RLIMIT_NPROC` is shared across Pods.

- Rejected: a single ConfigMap payload; image-level `RLIMIT_NPROC`; OCI image-volume payloads.
- Rule: the materializer rejects path traversal, missing chunks and size/hash mismatches.
- Rule: per-stage shards are deleted on success, failure and cancellation; testcase shards are cached instead (JDG-23).
- Code: `packages/core/src/schemas/problem.ts`, `apps/worker/src/sandbox/kubernetes/payload.ts`, `apps/sandbox-runner/src/payload-materializer.ts`

### JDG-22 Sandbox cleanup is UID-fenced and durable

**Decided:** 2026-09 · **Source:** [2026-09-21-judge-capacity](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-09-21-judge-capacity.md), [#596](https://github.com/NOJV-TW/NOJV/pull/596)

A run owns its Jobs, Pods, ConfigMaps, PVCs and temporary results; deletes carry UID preconditions, and unconfirmed cleanup is reported as `cleanup_pending` and retried durably. A stalled gVisor Pod deletion during the 2026-09-21 quota incident showed that name-based cleanup can hit the wrong object or leak capacity.

- Rejected: restarting k3s/containerd to clear remnants; deleting payload ConfigMaps only after the Pods are gone (a mounted ConfigMap's deletion does not affect a started or finished Pod, and the ordering kept answers in the API when termination stalled).
- Rejected: HTTP/2 to the Kubernetes API. `@kubernetes/client-node` 2 (v1.3.33) sends calls through undici, which negotiates HTTP/2 by default; in production large payload ConfigMap creates for 30-case problems (79, 80, 83) intermittently failed with `ERR_HTTP2_STREAM_ERROR` (`NGHTTP2_INTERNAL_ERROR` / `ENHANCE_YOUR_CALM`) from 2026-09-29, and a shared keep-alive dispatcher (#596) made it worse. Small-payload stress tests and the k3d suite did not exercise it. The worker forces HTTP/1.1, as the pre-2.0 client used, with per-request connections.
- Rule: runtime-level remnants need identity-checked operator verification; no production load tests during an exam.
- Rule: a stage's lease is released only after its Pods are gone and every per-stage payload ConfigMap delete succeeded; faster confirmation never skips a check. Cached testcase sets (JDG-23) are not run-owned and are never part of a stage's cleanup.
- Code: `apps/worker/src/sandbox/kubernetes/resource-cleanup.ts`, `apps/worker/src/sandbox/kubernetes/termination.ts`

### JDG-23 Testcase payloads are a content-addressed ConfigMap cache

**Decided:** 2026-09 · **Source:** [#603](https://github.com/NOJV-TW/NOJV/pull/603)

Kubernetes stages mount testcases from immutable ConfigMap sets keyed by the testcase content hashes of their stage range, one `input` and one `answer` set, instead of uploading them per stage; the worker keeps snapshot pointers and reads testcase objects only while it uploads a missing set. On 2026-09-29/30 every stage of problem 79 (30 cases, ~37 MB) uploaded ~100 ConfigMaps / ~70 MB to k3s and deleted them again, the mass creates hit HTTP/2 stream errors, and the judge worker was OOMKilled at 2 Gi because each slot resolved the whole problem and built both payloads (~700 MB per slot). On k3d with the same shape, four concurrent cold submissions went from 6.2–7.7 s to 1.1 s of payload time and +703 MB to +223 MB peak worker RSS; a warm stage takes 14–70 ms and reads no testcase bytes.

- Rejected: per-case ConfigMaps (100–200 projected sources per volume and one existence check per case); one set per problem version (a stage range is already a pure function of the snapshot, and a whole-problem set would exceed the 64 MiB stage budget); deterministic shard names without an index incarnation (a new set could reuse a shard that the garbage collector is still deleting); reading shards back to verify them (the materializer already verifies every file's size and SHA-256).
- Rule: the run volume never projects an `answer` set; unit tests pin it (JDG-05).
- Rule: an existing index is used only if its key and role labels and its layout equal the expected value; a mismatch is an infrastructure error, never overwritten.
- Rule: a set is deleted only after 12 h without use and when no Pod projects it, with `uid` and `resourceVersion` preconditions so a concurrent touch wins; stages touch the index when `last-used` is older than 10 min.
- Rule: cached chunk keys keep the `chunk-<digits>` form, so snapshots pinned to older sandbox images still materialize.
- Code: `apps/worker/src/sandbox/kubernetes/testcase-cache.ts`, `apps/worker/src/sandbox/kubernetes/testcase-cache-gc.ts`, `apps/worker/src/sandbox/kubernetes/resources.ts`, `apps/worker/src/sandbox/shared/stage-payload.ts`

### JDG-24 The judge worker sweeps orphaned payloads and guards its own memory

**Decided:** 2026-09 · **Source:** [#608](https://github.com/NOJV-TW/NOJV/pull/608)

On 2026-09-30 failed large payload uploads left 384 per-stage payload ConfigMaps (367 MB) in `nojv-sandbox`; recovery listing them OOMKilled the judge worker into CrashLoopBackOff and judging stopped until an operator deleted them and raised the memory limit. Two guards make that class repair itself. The worker's 15 min cache sweep also deletes a run-labelled `judge-<runId>-*` ConfigMap older than 10 min whose run has no Job and no Pod, listing only metadata by label. With load-aware slots, the slot budget also shrinks while the worker's own cgroup v2 working set is at or above 75% of its limit, so judging slows at the minimum instead of crash-looping.

- Rejected: alerting only (the incident needed a human while judging was down); a shorter age (the longest window between a stage's first payload ConfigMap and its Job is its payload creates plus one quota list and one Job create, each bounded by the API server's 60 s request timeout, so about 3 min; 10 min leaves margin); a longer age (orphans keep ConfigMap bytes in etcd and count against quota); `memory.current` alone (page cache counts toward it and is reclaimable, as in kubelet's working set).
- Rejected: a worker memory guard in fixed-slot mode. Fixed slots have no supplier, and the GKE and multi-replica deployments that use them size the worker explicitly; single-machine production runs load-aware slots.
- Rule: the orphan sweep never lists ConfigMap data, never touches objects without the `nojv-run-id` label or whose name does not start with `judge-<runId>-`, and deletes with a `uid` precondition; a 404 or 409 is skipped.
- Rule: the worker memory guard only stops growth and shrinks the budget to one below the running count, never under the minimum, never revoking a running stage; an unlimited or unreadable cgroup disables only this guard. It is a self-protection limit, not a capacity signal (JDG-13).
- Code: `apps/worker/src/sandbox/kubernetes/testcase-cache-gc.ts`, `apps/worker/src/judge-slot-supplier.ts`

### JDG-25 Stage results are read at container exit; cleanup starts at the terminal Pod

**Decided:** 2026-09 · **Source:** [PR #TBD](https://github.com/NOJV-TW/NOJV/pulls)

A standard, checker or interactive stage reads its logs once every declared container has exited 0, then waits (at most 10 s) for the Pod's terminal phase before deleting the Job; stage Pods use a 1 s termination grace period. Measured on k3d (runc, 1 and 6 concurrent stages, 3 and 30 cases), a stage's fixed cost is kubelet's: about 1 s from run-container exit to judge-container exit being reported (PLEG relists every second) and 1.2–1.5 s more until the Pod turns `Succeeded` (kubelet stops the sandbox only on its next sync). The worker's own share after `Succeeded` fell from 160–265 ms to 105–130 ms (median), and an aborted stage's cleanup from 25 s to 4 s because the runner, as PID 1, ignores SIGTERM. In production the log reads and API calls that now overlap sandbox teardown took 0.8–1.1 s per stage.

- Rejected: deleting the Job as soon as the containers exit. The Pod then reached `Succeeded` no sooner and was removed 0.7–0.9 s later than when deleted after `Succeeded` (cleanup 2.0 s instead of 0.14 s).
- Rejected: returning the stage result and releasing the slot before cleanup completes. Until kubelet marks the Pod terminal it still counts against the sandbox `ResourceQuota`, so a released slot would start a Job the quota rejects; JDG-22 keeps the lease until the Pods are gone, and after `Succeeded` only API deletions remain (about 0.1 s here).
- Rejected: returning results through `terminationMessagePath`. It holds 4 KiB, logs are still needed for per-case output, and log reads already overlap teardown.
- Rejected: kubelet `EventedPLEG` or other node tuning to cut the one-second relist; it is a node-level beta feature outside the chart, not validated with gVisor.
- Rule: early reads need every container declared in the Pod, including restartable sidecars, terminated with exit code 0; anything else waits for the Job or Pod terminal state.
- Rule: never delete a stage's Job before its Pod is terminal unless the 10 s wait expires or the stage failed; JDG-22's lease and UID rules are unchanged.
- Code: `apps/worker/src/sandbox/kubernetes/job-watch.ts`, `apps/worker/src/sandbox/kubernetes/job-state.ts`, `apps/worker/src/sandbox/kubernetes/standard-executor.ts`, `apps/worker/src/sandbox/kubernetes/interactive-executor.ts`, `apps/worker/src/sandbox/kubernetes/termination.ts`, `apps/worker/src/sandbox/kubernetes/job-manifests.ts`
