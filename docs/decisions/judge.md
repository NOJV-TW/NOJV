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

Each stage of up to `JUDGE_STAGE_CASES` (20) cases runs in one Pod: a run container compiles once and runs cases through the static helper `nojv-exec` (rlimits, subreaper, `wait4` CPU and peak RSS, summed-RSS kill), then the judge container. TLE uses the program's own CPU time; MLE is decided post-hoc from measured peak RSS including children. Per-case containers cost ~9 s of kubelet starts per stage and billed runner overhead to students; gVisor lacks `memory.peak`.

- Rejected: 50 ms `/proc` VmHWM polling (missed forked children); shared-container or per-case-container cgroup `memory.peak` (includes runner, cannot be reset under cap-drop; per-case containers shipped 2026-06/PR #149 then replaced); container wall-clock TLE; sibling-container waves (N x 500m broke the 4-CPU quota above 8 cases); DOMjudge runguard, DMOJ cptbox, Judge0 privileged containers, Firecracker/Kata; warm pod pool (revisit later).
- Rule: students are charged only for their own processes; wall clock is only a 2x watchdog.
- Rule: Pod requests must fit the sandbox ResourceQuota whatever the case count; a stage reserves `K8S_RUN_PARALLELISM` CPUs and the container memory limit covers P x (case limit + headroom) + runner.
- Rule: check for running interactive executions before changing stage size.
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

Each execution captures an immutable problem snapshot at dispatch; automatic recovery reuses it. A teacher rejudge (`single` or filtered `batch`) pins the latest effective problem version (including Advanced images) when accepted, keeps the old result visible until the new one commits, overwrites the Submission after a `SubmissionRejudgeLog` snapshot, and runs the normal post-judge path. Teachers expect rejudge to use their fix without resubmission losing timestamps; recovery must be reproducible.

- Rejected: pinning rejudge to the original snapshot; forcing students to resubmit; `score_rejudged` student notification. Fire-and-forget rejudge without progress (2026-04) was reversed: `RejudgeProgress` and cancellation exist.
- Rule: every rejudge writes a `SubmissionRejudgeLog` audit row (see PRB-18 in problems.md).
- Rule: a frozen contest scoreboard snapshot is not changed by rejudges or overrides until unfreeze.
- Rule: historical SE records without snapshots cannot be recovered from current problem contents.
- Code: `packages/application/src/submission/judge-execution.ts`, `packages/application/src/submission/rejudge-control.ts`, `packages/db/prisma/schema/submission.prisma`

### JDG-11 SE recovery is bounded and generation-guarded

**Decided:** 2026-07 · **Source:** [2026-07-15-admin-mode-se-recovery](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-15-admin-mode-se-recovery.md), [2026-08-11-single-machine-throughput-tuning](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-08-11-single-machine-throughput-tuning.md)

Sandbox pipeline failures store bounded SE diagnostics for the admin submissions view. Recovery runs only on the platform worker (stale sweep first), with at most one deterministic system rejudge per failed judge generation; the judge worker does no recovery scan. Restart recovery was unbounded and duplicated across workers.

- Rule: recovery must be generation-guarded and idempotent; at most one active judge workflow per submission.
- Code: `packages/application/src/submission/rejudge-control.ts`, `packages/application/src/submission/judge-recovery.ts`, `apps/worker/src/worker-app.ts`

### JDG-12 Judge queue is Temporal priority and fairness, not a coordinator

**Decided:** 2026-09 · **Source:** [2026-09-21-judge-capacity](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-09-21-judge-capacity.md), [2026-09-22-temporal-native-judge-queue](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-09-22-temporal-native-judge-queue.md)

Each `JudgeExecution` runs `durableJudgeWorkflow` on the `judge` queue with `priorityKey` (exam 1, contest 2, practice/assignment 3, recovered submission 4, rejudge 5) and `fairnessKey = studentId`; a student has at most one dispatched non-terminal execution and completion dispatches the next. Capacity is judge worker activity slots, with the sandbox ResourceQuota as hard safety net. A 789-execution rejudge collapsed the workflow-based coordinator.

- Rejected: `judgeAdmissionWorkflow` coordinator with FIFO/permit loops and waves (removed with `JudgeAdmission`, `capacityStrategy`); Kueue (quota-based; revisit only for shared multi-node clusters); HPA/KEDA on one node.
- Rule: self-hosted Temporal needs `matching.enableFairness` and one partition per NOJV queue.
- Rule: stage and bookkeeping activities carry priority; bookkeeping runs on `judge-state` so it never queues behind Jobs; unmapped paths degrade to priority 3.
- Rule: priority derives from origin (`operationId` marks a rejudge, `recoveryEpoch` a recovery), never from `queueClass`, which only orders a student's own executions; recovered live submissions dispatch ahead of bulk rejudges.
- Rule: rollback re-dispatches execution rows via the reconciler; never replay new histories with old worker code.
- Code: `packages/core/src/judge-execution.ts`, `packages/application/src/submission/judge-recovery.ts`, `infra/docker/temporal-dynamic-config.yaml`

### JDG-13 Load-aware judge slots via Temporal's resource-based tuner

**Decided:** 2026-09 · **Source:** [2026-09-22-judge-slot-tuner](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-09-22-judge-slot-tuner.md)

With `WORKER_MIN_CONCURRENCY` set, the judge worker's activity slots use the resource-based tuner (CPU 0.75, memory 0.8) between min and `WORKER_CONCURRENCY`; fixed mode remains. The judge container has no CPU limit so the tuner sees node CPU. A fixed count cannot track load, and Kubernetes does not decide how many Jobs start.

- Rejected: custom slot supplier on the metrics API; Kueue; HPA/KEDA; long `rampThrottle` (throttles polling).
- Rule: workflow-task slots stay fixed; `judge_wall_clock_timeouts_total` is the contention guard (lower the ceiling if it fires); watch node memory separately.
- Rule: GKE stays on fixed slots until a multi-node plan.
- Code: `apps/worker/src/worker-app.ts`, `infra/charts/nojv/values-single-machine.yaml`

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
- Rule: never add update, patch, Secret or cross-namespace access to the `sandbox-job-manager` role; it keeps only create/get/list/watch/delete on sandbox resources.
- Code: `apps/worker/src/sandbox/kubernetes/runtime-probe.ts`, `apps/worker/src/sandbox/kubernetes/netpol-probe.ts`, `apps/worker/src/sandbox/kubernetes/job-watch.ts`, `infra/charts/nojv/templates/namespaces.yaml`, `infra/charts/nojv/templates/worker-rbac.yaml`

### JDG-21 10 MiB testcases via sharded, hash-verified payloads

**Decided:** 2026-07 · **Source:** [2026-07-15-10mb-testcase-payload](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-15-10mb-testcase-payload.md)

The testcase limit is 10 MiB of UTF-8 (`MAX_TESTCASE_FILE_BYTES`). K8s payloads are split into immutable binary ConfigMap shards with a manifest (path, chunks, size, SHA-256); a hardened materializer rebuilds them into an emptyDir before student code starts. Process limits use the per-Pod cgroup PID limit, since host-UID-wide `RLIMIT_NPROC` is shared across Pods.

- Rejected: a single ConfigMap payload; image-level `RLIMIT_NPROC`; OCI image-volume payloads.
- Rule: the materializer rejects path traversal, missing chunks and size/hash mismatches.
- Rule: shards are deleted on success, failure and cancellation.
- Code: `packages/core/src/schemas/problem.ts`, `apps/worker/src/sandbox/kubernetes/payload.ts`, `apps/sandbox-runner/src/payload-materializer.ts`

### JDG-22 Sandbox cleanup is UID-fenced and durable

**Decided:** 2026-09 · **Source:** [2026-09-21-judge-capacity](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-09-21-judge-capacity.md)

A run owns its Jobs, Pods, ConfigMaps, PVCs and temporary results; deletes carry UID preconditions, and unconfirmed cleanup is reported as `cleanup_pending` and retried durably. A stalled gVisor Pod deletion during the 2026-09-21 quota incident showed that name-based cleanup can hit the wrong object or leak capacity.

- Rejected: restarting k3s/containerd to clear remnants.
- Rule: runtime-level remnants need identity-checked operator verification; no production load tests during an exam.
- Code: `apps/worker/src/sandbox/kubernetes/resource-cleanup.ts`, `apps/worker/src/sandbox/kubernetes/termination.ts`
