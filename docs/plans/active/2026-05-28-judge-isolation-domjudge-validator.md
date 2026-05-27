# Judge Isolation + DOMjudge Validator + Special-Judge Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the testcase-exposure cheating hole in the judge, replace NOJV's custom special-judge protocol with the DOMjudge/Kattis output-validator standard, move judge scripts to object storage, ship a downloadable TA scaffold, and clear the special-judge security/UX ledger.

**Architecture:** Today the sandbox runner and the student program share one container and one mount namespace, so the student program can read `/submission/.../expected.txt` and the validator source and trivially cheat. Our container hardening (`cap-drop ALL`, `no-new-privileges`, non-root, K8s `allowPrivilegeEscalation:false`) blocks in-container self-isolation (no `unshare`/`chroot`/`setuid`), and unprivileged user namespaces are unreliable on GKE/COS. The fix is therefore **run/check separation**: the student program runs in a container that never sees answers or validator code; comparison/validation happens elsewhere (worker-side for standard mode — zero throughput cost; a separate validator container for checker mode; a two-container piped pair for interactive). The validator interface adopts the DOMjudge/Kattis standard.

**Tech Stack:** TypeScript/ESM, Temporal worker (`apps/worker`), sandbox runner (`apps/sandbox-runner`, Node on Alpine), Docker + Kubernetes executors, `@nojv/core` (Zod schemas), `@nojv/domain`, `@nojv/db` (Prisma 7), `@nojv/storage` (S3/MinIO), SvelteKit web, Vitest.

---

## PROGRESS (branch `feat/judge-isolation-domjudge`, updated 2026-05-28)

- ✅ **Phase 0** — done & reviewed (commits `f98c68e1`, `3fcce079`). env injection + verdict enum alias. (0.3 reclassified → Phase 1 Task 1.4a as a wire-through, not a deletion.)
- ✅ **Phase 1** — done & reviewed; **security invariant verified by a real-Docker exploit test** (`a281f8d1`…`efcd258b`). Standard-mode answers no longer reach the student container; AC/WA computed worker-side; `runtime.env` wired through.
- ✅ **Infra fix** (`6ed3a95b`) — `corepack enable` → `pnpm install` across all 4 Dockerfiles (node:26 dropped corepack; was blocking `pnpm sandbox:build`).
- ✅ **Task 2.1** — done (`5e13a6ea`). DOMjudge validator protocol primitives in `@nojv/core`.
- ✅ **Phase 2B** (checker isolation + validator container) — done & reviewed; **real-Docker verified** (`8404c1b7`…`95c640b0`). Checker runs isolated; validator runs in a separate hardened container; exploit reading validator/answer does NOT get AC.
- ✅ **Phase 2C** (interactive isolation, two containers + worker byte proxy) — done & reviewed; **real-Docker verified** (`878c39e5`…`c7ce5faf`). Secret mounted only into the interactor container; guessing-game AC/WA + exploit verified.
- ✅ **Phase 2D** (remove testlib + legacy code + DOMjudge examples/i18n/docs) — done (`94268172`…`17833458`). testlib gone from image; TA examples + JUDGE_PIPELINE rewritten for DOMjudge.
- ✅ **Task 2.9** (re-author demo seed checker/interactive to DOMjudge + re-seed) — done & **real-Docker verified** (`6c26a58a`; storage upload `fe966056`). 5 seed problems re-authored; judged AC/WA correctly on the live stack.
- ✅ **Phase 3** (judge scripts → MinIO) — done & reviewed; **live-stack verified** (`688a174c`…`56f9afea`). `checkerKey`/`interactorKey` in `judgeConfig`, bodies in MinIO; edit-page hydration gated on edit access; judge-time storage failure fails closed. **Q6 complete — no judge script body remains in Postgres.**
- ✅ **Phase 5a** (advanced disk cap + read-only rootfs + standard CPU rlimit) — done & reviewed; **real-Docker verified** (`93a344ad`, `2cab5cda`, fixes `d03941c9`). du-poll 1 GiB cap, `--read-only` + `/tmp` tmpfs, `ulimit -t` on solution; SE-reclassification tightened to exit 126/127.
- ✅ **Phase 4** (downloadable advanced-judge scaffold + `nojv_grader` helper + tutorial) — done & reviewed; **real-Docker verified** (`89828f91`, `a4d3776d`; doc-claim fix follow-up). Self-contained zip (`FROM python:3.12-slim`, no registry dep); scaffold builds + produces schema-valid result.json.
- ⬜ **Task 2.7** (staff/student message split — surface validator `judgeMessage` to staff) — DEFERRED as a UX follow-up. `teamMessage`→student `feedback`; `judgeMessage` dropped (never leaks). Not blocking.
- ⬜ **Task 2.8 / 5b** (full K8s parity for checker/interactive/advanced) — DEFERRED. Interim: K8s `execute` fail-fasts (SE + operator log) for all three; **checker + interactive + advanced are Docker-backend-only**. Safe (no mis-grade / no leak).

**Status: ALL implementation phases complete and verified (real-Docker / live-stack for every security-critical part).** Branch green (`typecheck`/`lint`/984 unit). Final holistic review: ✅ ready to merge for the core security goal. Deferred (documented, non-blocking): 2.7 message split, 2.8/5b full K8s parity (Docker-only interim is safe).

**Known pre-existing issue (NOT this branch):** `infra/docker/worker.Dockerfile` + `web.Dockerfile` reference the removed `packages/job-dispatch` (merged into `@nojv/temporal` in the architecture redesign) — will break those two image builds. This branch only changed their `corepack→pnpm install` line. Needs a separate maintainer fix.

---

## Reading order before starting

1. `docs/architecture/JUDGE_PIPELINE.md` — current pipeline (will be updated by this plan).
2. `docs/operations/SECURITY.md` §"Sandbox Hardening" — the hardening constraints that rule out in-container self-isolation.
3. This plan's **Design Decisions** section below.

## Design Decisions (locked with product owner 2026-05-28)

- **Isolation model:** run/check separation, privilege-free, works on both Docker and K8s. NOT per-case containers (throughput) and NOT in-container namespaces (blocked by hardening + GKE userns unreliability). References: DOMjudge `runguard` (privileged supervisor + unprivileged child), IOI `isolate`, `nsjail` — we adopt their *separation principle* without needing their privilege by splitting run from check across process/container boundaries.
- **Validator protocol:** DOMjudge / Kattis output-validator standard. Validator invoked as `validator <input_file> <judge_answer_file> <feedback_dir>` with **team output on stdin**. Exit **42 = accept**, **43 = wrong answer**, anything else = judge error (→ SE). Score for scoring problems read from `<feedback_dir>/score.txt`; operator message from `<feedback_dir>/judgemessage.txt`; student-visible message from `<feedback_dir>/teammessage.txt`.
- **PE verdict:** NOT added. DOMjudge/Kattis has no presentation-error verdict (folds into WA). Verdicts stay `AC/WA/TLE/MLE/RE/SE`. (Product owner chose DOMjudge specifically for standard-compliance; do not deviate.)
- **Standard-mode leniency:** keep the existing `normalize()` (CRLF→LF, strip per-line trailing whitespace, strip trailing blank lines) — equivalent to the DOMjudge default validator's whitespace leniency. Float tolerance etc. are opt-in via a custom validator. Do NOT inherit Codeforces byte-exact strictness.
- **testlib:** removed entirely (vendored header, Dockerfile copy, C++ examples, i18n strings, docs). No fork. C++ validators use the DOMjudge interface directly.
- **Scripts in storage:** `checkerScript`/`interactorScript` move out of the `Problem.judgeConfig` JSON column into MinIO, mirroring `ProblemWorkspaceFile.contentKey`.
- **TA delivery:** primary path is a **downloadable zip scaffold** with a pre-filled `Dockerfile` (`FROM` already set) so TAs never hand-write `FROM`. An official base image backs the scaffold and is available to power users; a short tutorial covers building from scratch.

## Phase ordering & dependencies

```
Phase 0  Prompt-bug quick fixes (env, verdict enum, remove runtime.env)   [independent, ship first]
Phase 1  Standard-mode run/check isolation                                 [independent, urgent]
Phase 2  DOMjudge validator + checker/interactive isolation + remove testlib [depends: Phase 1 raw-result plumbing]
Phase 3  Judge scripts → MinIO                                             [depends: Phase 2 settles validator field naming]
Phase 4  TA base image + zip scaffold + tutorial                          [depends: Phase 2 protocol]
Phase 5  Advanced-mode hardening + K8s advanced support                   [Phase 5a independent; 5b K8s deferred/standalone]
```

Each phase ends green (`pnpm typecheck && pnpm lint && pnpm test:unit`) and is a separate commit (or small commit series). Phases 1–2 additionally require a **real judging run** (mocked tests cannot catch sandbox docker-arg bugs — see `seccomp_default_judging_footgun` memory).

---

## Phase 0: Prompt-bug quick fixes

Independent, low-risk, immediate. No dependency on the isolation work.

### Task 0.1: Inject `SUBMISSION_ID` / `LANGUAGE` env into advanced containers

The UI (`ContainerContractSection.svelte:83-84`) promises these env vars but the executor never sets them — a TA reading `os.environ["LANGUAGE"]` gets a `KeyError`.

**Files:**
- Modify: `apps/worker/src/services/advanced-mode-executor.ts` (the `args` array in `spawnContainer`, ~line 131-152)
- Test: `tests/unit/worker/advanced-mode-executor.test.ts` (create if absent; otherwise add a case)

**Step 1 — failing test:** assert the docker args include `--env SUBMISSION_ID=<id>` and `--env LANGUAGE=<lang>`. If the executor isn't unit-testable in isolation, extract the arg-building into a pure `buildAdvancedDockerArgs(request, config, imageRef, workspaceDir)` helper and test that.

**Step 2:** run, expect FAIL.

**Step 3 — implement:** add to the `args` array:
```ts
"--env", `SUBMISSION_ID=${request.submissionId}`,
"--env", `LANGUAGE=${request.language}`,
```

**Step 4:** run, expect PASS.

**Step 5 — commit:** `fix(judge): inject SUBMISSION_ID/LANGUAGE env into advanced containers`

### Task 0.2: Fix result.json top-level verdict enum in the TA contract UI

`ContainerContractSection.svelte:101` shows `accepted | wrong_answer | tle | mle | re | ce`, but `advancedResultSchema` (`packages/core/src/schemas/advanced-mode.ts:16-23`) requires `accepted | wrong_answer | time_limit_exceeded | memory_limit_exceeded | runtime_error | compile_error`. A TA copying the example gets a Zod failure → whole submission SE.

**Files:**
- Modify: `apps/web/src/lib/components/features/problem/advanced/ContainerContractSection.svelte:99-106` (the inline `<pre>` JSON example)
- Modify: `packages/core/src/schemas/advanced-mode.ts` — add short-code aliases for robustness
- Test: `tests/unit/core/advanced-mode-schema.test.ts`

**Step 1 — failing test:** `advancedResultSchema.parse({score: 0, verdict: "tle"})` should succeed (alias) AND `verdict: "time_limit_exceeded"` should still succeed; assert both normalize to the long form.

**Step 2:** run, expect FAIL.

**Step 3 — implement:** preprocess short codes to long form before the enum:
```ts
const VERDICT_ALIASES: Record<string, string> = {
  tle: "time_limit_exceeded", mle: "memory_limit_exceeded",
  re: "runtime_error", ce: "compile_error", ac: "accepted", wa: "wrong_answer",
};
verdict: z.preprocess(
  (v) => (typeof v === "string" && VERDICT_ALIASES[v.toLowerCase()]) || v,
  z.enum(["accepted","wrong_answer","time_limit_exceeded","memory_limit_exceeded","runtime_error","compile_error"]),
),
```
Then fix the UI `<pre>` to show the canonical long names and add a one-line note that per-case `verdict` uses short codes (`AC|WA|TLE|MLE|RE|SE`) while the top-level uses long names.

**Step 4:** run, expect PASS.

**Step 5 — commit:** `fix(judge): accept short verdict codes + correct advanced result.json example`

### Task 0.3: Wire `runtime.env` through to the judged process (CORRECTED 2026-05-28)

**Correction:** the original premise ("no UI editor exists, remove it") was WRONG. `runtime.env` is a live, wired, user-facing feature: `apps/web/src/lib/components/features/problem/workspace/WorkspaceRuntimeSection.svelte` renders a key/value env editor, `WorkspaceSection.svelte` reads/writes it, and `updateProblemWorkspace` persists it to `judgeConfig.runtime.env`. It is "persisted-but-ignored" — collected and stored but never reaches the sandbox (`SandboxRequest.limits` only carries `timeoutMs`/`memoryMb`). Product decision (2026-05-28): **wire it through** (honors "流程完全接通"), do NOT delete the feature.

**This is folded into Phase 1** because Phase 1 already restructures the limits plumbing and the solution-run path. Implement it there (see Phase 1 Task 1.4a). Env is teacher-controlled and runs inside the hardened sandbox → safe.

**Files (done in Phase 1):**
- `packages/core/src/sandbox.ts` — add `env?: Record<string, string>` to `SandboxRequest.limits`.
- `apps/worker/src/activities/judge.ts:171-174` — set `limits.env` from `judgeContext.runtime.env`.
- `apps/sandbox-runner/src/types.ts` — add `env` to `SandboxInputSchema.limits`.
- The solution-run spawn (`run-process.ts` / the new `runSolution`) — pass `env: { ...process.env, ...(limits.env ?? {}) }` for the **solution only** (NOT the validator or compiler).
- `docs/architecture/JUDGE_PIPELINE.md` §execute — keep the `env` bullet but mark it now-functional.

**Phase 0 acceptance:** Tasks 0.1 + 0.2 done; `pnpm typecheck && pnpm lint && pnpm test:unit` green (865 tests). Task 0.3 reclassified into Phase 1.

---

## Phase 1: Standard-mode run/check isolation (URGENT)

**Why first/urgent:** any student can currently submit a program that reads `/submission/testcases/*/expected.txt` and prints the answer → guaranteed AC on every standard problem. Standard mode is the common case and the fix is **zero-throughput-cost** (comparison was always trivial string work; we move it from the in-container runner to the worker, and stop shipping answers into the run container).

**Approach:** worker keeps expected answers in memory (it already has `request.testcases[].output`), stops writing `expected.txt` into the run mount/ConfigMap, the runner runs the solution and emits a **raw per-case run result** (no AC/WA decision), and the worker computes AC/WA by comparison using a shared normalizer.

### Task 1.1: Red-light exploit test (prove the hole, lock the fix)

**Files:**
- Create: `tests/integration/judge/testcase-exposure.test.ts`

**Step 1 — write the exploit test (must FAIL = currently AC, proving the hole):**
A Python submission that scans `/submission` for its matching input and prints the sibling expected output. Submit it against a seeded standard problem via the real Docker executor. Assert the verdict is **WA** (after the fix) — initially this test documents the hole and will be RED until Task 1.4.
```python
import sys, glob, os
mine = sys.stdin.read()
for d in glob.glob("/submission/testcases/*"):
    try:
        if open(os.path.join(d, "input.txt")).read() == mine:
            sys.stdout.write(open(os.path.join(d, "expected.txt")).read()); break
    except OSError:
        pass
```
Mark with the integration tag so it runs under `pnpm test:integration` (real Docker), not plain unit.

**Step 2:** run against current code, expect the exploit to get **AC** (hole confirmed). Record this in the commit message.

**Step 5 — commit:** `test(judge): add failing exploit test for testcase exposure (red)`

### Task 1.2: Move the output normalizer + comparator into `@nojv/core`

So both the runner (today) and the worker (after this phase) share one definition.

**Files:**
- Create: `packages/core/src/judge/compare.ts` — export `normalizeOutput(s: string): string` and `compareStandard(actual: string, expected: string): boolean` (copy logic from `apps/sandbox-runner/src/judges/standard.ts:10-27`)
- Modify: `packages/core/src/index.ts` — re-export
- Modify: `apps/sandbox-runner/src/judges/standard.ts` — import from `@nojv/core` instead of defining locally
- Test: `tests/unit/core/judge-compare.test.ts`

**Steps:** TDD the moved function (CRLF, trailing whitespace, trailing blank lines), then swap the runner to import it. Unit green.

**Step 5 — commit:** `refactor(judge): hoist output normalizer to @nojv/core`

### Task 1.3: Add a raw run-result channel to the sandbox output

The runner must be able to return "the program ran, here is stdout/exit/time/mem, no verdict" so the worker decides AC/WA.

**Files:**
- Modify: `packages/core/src/sandbox.ts` — extend `SandboxResult` with an optional `rawRun?: boolean` marker on results that still need worker-side checking, OR add a dedicated `RawCaseResult` list. Decision at execution time: simplest is to keep `SandboxTestcaseResult` but allow `verdict: "PENDING_CHECK"` as an internal-only sentinel that never persists (strip before `mapResult`). Prefer a separate field to avoid widening the public verdict enum:
  ```ts
  // Raw, pre-check per-case run outcome emitted by the runner when the
  // verdict depends on an external check the runner cannot perform
  // (it has no access to expected output / validator).
  export interface RawCaseRun {
    index: number;
    stdout: string;
    stderr: string;
    exitCode: number;
    timeMs: number;
    memoryKb?: number;
    errorVerdict?: Extract<SandboxVerdict, "TLE" | "MLE" | "RE" | "SE">; // set only on failure
  }
  ```
  Add `rawRuns?: RawCaseRun[]` to `SandboxResult` (mutually exclusive with `testcaseResults`).
- Modify: `apps/sandbox-runner/src/types.ts` (`SandboxOutput` schema) to allow emitting `rawRuns`.
- Test: `tests/unit/core/sandbox-schema.test.ts`

**Step 5 — commit:** `feat(judge): add raw run-result channel for worker-side checking`

### Task 1.4: Runner emits raw runs for standard mode; stop deciding AC/WA in-container

**Files:**
- Modify: `apps/sandbox-runner/src/judges/standard.ts` — split into `runSolution()` (run + `classifySolutionVerdict`) returning a `RawCaseRun`; the AC/WA comparison no longer happens here.
- Modify: `apps/sandbox-runner/src/index.ts:284-323` — for `judgeType === "standard"`, collect `RawCaseRun[]` and `emit({ rawRuns })` instead of `testcaseResults`.

**Steps:** unit-test that standard mode emits `rawRuns` with `errorVerdict` set only for TLE/MLE/RE/SE and unset for clean runs.

**Step 5 — commit:** `feat(judge): runner emits raw runs for standard mode (no in-container verdict)`

### Task 1.4a: Wire `runtime.env` through to the judged process (from corrected Phase 0.3)

Make the existing (persisted-but-ignored) per-problem env editor actually inject env into the student program.

**Files:**
- Modify: `packages/core/src/sandbox.ts` — add `env?: Record<string, string>` to `SandboxRequest.limits`.
- Modify: `apps/worker/src/activities/judge.ts` — in the `request.limits` literal (around lines 171-174), add `...(judgeContext.runtime.env && Object.keys(judgeContext.runtime.env).length > 0 ? { env: judgeContext.runtime.env } : {})`.
- Modify: `apps/sandbox-runner/src/types.ts` — add `env: z.record(z.string(), z.string()).optional()` to `SandboxInputSchema.limits`.
- Modify: the **solution** spawn only — extend `runProcess`/`runSolution` (`apps/sandbox-runner/src/judges/run-process.ts`) to accept an `env` option and pass `env: { ...process.env, ...(opts.env ?? {}) }` to `spawn`. Thread `config.limits.env` into the solution run in `index.ts`. Do NOT pass it to the validator or compiler spawns.
- Test: unit test that `runProcess` forwards env; a worker test that `limits.env` flows into config.json.

**Step — commit:** `feat(judge): inject per-problem runtime.env into the judged process`

**Files:**
- Modify: `apps/worker/src/services/standard-mode-executor.ts:97-107` — write only `input.txt`, never `expected.txt`.
- Modify: `apps/worker/src/services/k8s-executor.ts:128-133` — write only `testcase-{i}-input.txt`, never `-expected.txt`.

**Steps:** update/extend executor unit tests to assert no `expected` file/key is produced.

**Step 5 — commit:** `fix(judge): never ship expected output into the run container`

### Task 1.6: Worker computes AC/WA from raw runs + in-memory expected

**Files:**
- Create: `apps/worker/src/services/check-standard.ts` — `resolveStandardResults(rawRuns: RawCaseRun[], testcases: SandboxTestcase[]): SandboxTestcaseResult[]` using `compareStandard` from `@nojv/core`; honor `errorVerdict` first, else compare `stdout` vs `testcases[i].output`, else (no expected) treat as AC of run? — define: standard problems always have expected; if missing, SE.
- Modify: `apps/worker/src/services/standard-mode-executor.ts` — after parsing runner output, if `rawRuns` present, call `resolveStandardResults` and return `{ testcaseResults }`.
- Modify: `apps/worker/src/services/sandbox-schema.ts` — accept the `rawRuns` shape.
- Test: `tests/unit/worker/check-standard.test.ts`

**Steps:** TDD `resolveStandardResults` (AC, WA, each error verdict, missing-expected→SE). Then wire into the executor.

**Step 5 — commit:** `feat(judge): worker-side standard comparison from raw runs`

### Task 1.7: Turn the exploit test green + real judging run

**Steps:**
- Run `tests/integration/judge/testcase-exposure.test.ts` against the rebuilt sandbox image (`pnpm sandbox:build` first) — the exploit must now get **WA** (it reads nothing useful; `/submission` no longer holds answers).
- Run a normal AC submission and a normal WA submission to confirm no regression.
- Per `seccomp_default_judging_footgun` memory: this MUST be a real Docker run, not mocked.

**Step 5 — commit:** `test(judge): testcase-exposure exploit now fails (green)`

**Phase 1 acceptance:** exploit test green; standard AC/WA correct on a real run; `pnpm typecheck && pnpm lint && pnpm test:unit` green.

---

## Phase 2: DOMjudge validator + checker/interactive isolation + remove testlib

**Depends on:** Phase 1's `RawCaseRun` plumbing.

Two intertwined goals: (a) adopt the DOMjudge output-validator interface, (b) isolate checker/interactive so the student program never sees the validator or answers. Because the DOMjudge validator is naturally a separate program, (a) and (b) land together.

### Task 2.1: Define the DOMjudge validator protocol in `@nojv/core`

**Files:**
- Create: `packages/core/src/judge/validator.ts` — constants and parser:
  - `VALIDATOR_EXIT_ACCEPT = 42`, `VALIDATOR_EXIT_WRONG = 43`
  - `parseValidatorFeedback(exitCode, feedbackDir contents)` → `{ verdict: "AC"|"WA"|"SE", score?: number, teamMessage?: string, judgeMessage?: string }`. AC only on 42, WA on 43, any other code → SE. `teamMessage` from `teammessage.txt`, `judgeMessage` from `judgemessage.txt`.
  - **`score.txt` mapping (decide + document here):** DOMjudge `score.txt` is a float. Define NOJV's convention as **`score.txt` in `[0,1]` → multiply by 100 → clamp to `[0,100]`** to land on the existing per-case 0–100 `score` field that `PROPORTIONAL` subtask scoring averages (`JUDGE_PIPELINE.md` §score). If `score.txt` is absent, score defaults to 100 on AC / 0 on WA. Values >1 are treated as already-0–100 and clamped (tolerate both conventions).
- Test: `tests/unit/core/validator-protocol.test.ts` — cover exit 42/43/other, score.txt present/absent/`[0,1]`/`>1`, message file presence.

**Step 5 — commit:** `feat(judge): DOMjudge/Kattis output-validator protocol in core`

### Task 2.2: Run the solution in isolation for checker/interactive

For checker mode the solution run is identical to standard (emit `RawCaseRun`). Reuse Task 1.4's path for `judgeType === "checker"` too: run solution → raw stdout per case, with NO validator script and NO expected mounted.

**Files:**
- Modify: `apps/sandbox-runner/src/index.ts` — for `checker`, emit `rawRuns` (same as standard). Drop the in-container checker compile/run path (`index.ts:235-253`, `judges/checker.ts`).
- Modify: `apps/worker/src/services/standard-mode-executor.ts` / `k8s-executor.ts` — do NOT write `checker.*` or `expected.txt` into the run mount.

**Step 5 — commit:** `refactor(judge): run solution in isolation for checker mode`

### Task 2.3: Validator container (check phase) — Docker

A second, short-lived container that runs the TA validator with answers + team output but **no student code**.

**Files:**
- Create: `apps/worker/src/services/validator-executor.ts` — `runValidator({ input, judgeAnswer, teamOutput, validatorScript, validatorLanguage, limits }): Promise<{verdict, score?, teamMessage?, judgeMessage?}>`. Lays out a tempdir with `input`, `judge_answer`, the validator, and an empty `feedback/`; runs `docker run` (same hardening as standard: `--network none --cap-drop ALL --read-only --user 10001 --no-new-privileges`, tmpfs) invoking `validator <input> <judge_answer> <feedback_dir>` with `teamOutput` piped to stdin; parses via `parseValidatorFeedback`.
- Create: a validator entrypoint in the sandbox image that compiles (C++) or wraps (Python) the validator and execs it with the three path args — reuse `compileChecker` machinery, renamed for validators.
- Modify: `apps/worker/src/services/standard-mode-executor.ts` — after the run phase, for `checker` mode loop cases through `runValidator` and assemble `testcaseResults`.
- Test: `tests/unit/worker/validator-executor.test.ts` (arg building) + an integration test with a real validator.

**Throughput note:** +1 validator container per submission (not per case — batch all cases through one validator container invocation by passing them as a manifest, OR accept per-case invocation for checker problems which are a minority; decide at execution time, default to per-submission batch).

**Step 5 — commit:** `feat(judge): isolated DOMjudge validator container (checker mode)`

### Task 2.4: Interactive = two containers + worker pipe proxy

**Files:**
- Create: `apps/worker/src/services/interactive-executor.ts` — spawn the solution container (stdio piped to worker) and the validator/interactor container (input/secret mounted **only here**, stdio piped to worker); the worker shuttles bytes solution↔interactor; on close, parse interactor exit + `feedback_dir`. Enforce wall-clock timeout + SIGKILL on both.
- Modify: executor dispatch to route `judgeType === "interactive"` here.
- Test: integration test with the guessing-game interactor (port the existing example to the DOMjudge interactive interface).

**Key fairness point:** the secret lives in the input file, which is mounted only into the interactor container — the solution container never has it on disk.

**Step 5 — commit:** `feat(judge): isolated interactive judging via two-container pipe proxy`

### Task 2.5: Remove testlib entirely

**Files (delete/edit):**
- Delete: `apps/sandbox-runner/assets/testlib/testlib.h`, `apps/sandbox-runner/assets/testlib/README.md`, `apps/sandbox-runner/assets/testlib/LICENSE`
- Modify: `infra/docker/sandbox-runner.Dockerfile` — remove the two `COPY ... testlib.h` / `... LICENSE` lines and their comment block
- Modify: `apps/sandbox-runner/src/compiler.ts` — remove the testlib comment (`:118-119`) and ensure the C++ validator compile path no longer references testlib
- Modify: `apps/web/src/lib/components/features/problem/tabs/judge/script-examples.ts` — replace `CPP_CHECKER_EXAMPLE` / `CPP_INTERACTOR_EXAMPLE` (and the Python ones) with DOMjudge-style examples (read team output from stdin, `argv[1..3]` = input/answer/feedbackdir, exit 42/43, write `score.txt`/`teammessage.txt`)
- Modify: `apps/web/messages/en.json` + `apps/web/messages/zh-TW.json` — remove/replace testlib-mentioning strings (then recompile paraglide — see memory: `pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`)
- Modify: `docs/architecture/JUDGE_PIPELINE.md`, `docs/architecture/DESIGN.md` — drop testlib references, document the DOMjudge interface

**Step 5 — commit:** `chore(judge): remove vendored testlib (replaced by DOMjudge validator interface)`

### Task 2.6: Update the per-case wrappers + docs for the DOMjudge interface

**Files:**
- Modify: `apps/sandbox-runner/assets/wrappers/` — replace `python-checker.py` / `python-interactor.py` with DOMjudge-shaped Python helpers (`team_output` from stdin, `judge_input`/`judge_answer` from argv files, `feedback_dir` from argv; helpers `accept()`, `wrong(msg)`, `set_score(n)` writing the right files + exit codes).
- Modify: `docs/architecture/JUDGE_PIPELINE.md` §check — rewrite for the DOMjudge protocol; document run/check separation and the fairness invariant ("the run container never mounts answers or validator code").

### Task 2.7: Surface team vs judge messages (student vs staff feedback)

DOMjudge splits feedback into student-visible (`teammessage.txt`) and operator-only (`judgemessage.txt`). Today `SandboxTestcaseResult.feedback` is a single field shown to everyone.

**Files:**
- Modify: `packages/core/src/sandbox.ts` — keep `feedback` as the **student-visible** field (← `teamMessage`); add `staffFeedback?: string` (← `judgeMessage`).
- Modify: `packages/domain/src/submission/scoring.ts` (`mapResult`/`buildSubtaskResults`) and the persisted submission/case-result schema — carry `staffFeedback` and gate it: students never receive it.
- Modify: the submission detail UI (the shared case-result components: `SubtaskResultTree`/`CaseResultGrid` per the `submission_unification_2026_05_27` memory) — show `staffFeedback` only when the viewer is staff (reuse the existing staff-vs-student gating used for the `/submissions/[id]` review surface).
- Test: a domain test that a student-facing `SubmissionResult` omits `staffFeedback`; a staff-facing one includes it.

**Step 5 — commit:** `feat(judge): split validator feedback into student vs staff channels`

### Task 2.8: Backend parity — K8s realization + interactive scope

The isolation design above is described in Docker terms. K8s currently runs everything in one pod; isolation must not reintroduce shared-namespace exposure.

**Files / decisions:**
- Modify: `apps/worker/src/services/k8s-executor.ts`:
  - **Standard/checker run phase:** the run Job's ConfigMap must NOT contain expected/validator keys (Phase 1 Task 1.5 already removes expected; ensure validator keys are also excluded). Run pod emits `rawRuns`.
  - **Checker validate phase:** create a **second, separate Job** (validator pod) mounting input + judge_answer + validator + the captured team output, with **no student code** — never a second container in the same pod (same pod = shared volumes → re-exposes answers). Worker waits, reads `feedback_dir` via pod logs/an emitted JSON line.
  - **Interactive on K8s:** live cross-pod bidirectional piping through the worker is not practical via the Job API. **Decision: restrict `judgeType === "interactive"` to the Docker backend for now** — mirror the existing advanced-mode guard (`k8s-executor.ts:51-58`): return a neutral learner-facing SE, log an operator message ("interactive judging requires the Docker backend"). Track full K8s interactive support alongside Phase 5b.
- Modify: `docs/operations/SECURITY.md` / `JUDGE_PIPELINE.md` — document that interactive (like advanced) is Docker-backend-only until K8s parity lands.
- Test: unit test the K8s guard for interactive; integration only runs on Docker.

**Step 5 — commit:** `feat(judge): K8s isolated validator job; interactive gated to Docker backend`

### Task 2.9: Migrate / re-author existing checker & interactive problems

Switching protocols **breaks every existing checker/interactor script** (old ones target NOJV's custom stdout-score/stderr protocol or testlib; new ones must use exit 42/43 + feedback files). This is a hard breaking change, not a silent migration.

**Files / actions:**
- Audit: `grep` the seed (`packages/db/prisma/seeds/problems.ts`) and any dev DB for `judgeType` checker/interactive problems.
- Rewrite the demo seed's checker/interactive scripts to the DOMjudge interface (this is the canonical example set anyway).
- Add a one-time note in the migration (Phase 3 Task 3.1) / release notes: existing checker/interactive problems must have their validator re-authored; there is no automatic protocol translation. Until re-authored, those problems should be flagged (e.g. surfaced in the manage UI) or fail closed to SE with a clear operator message rather than silently mis-grading.
- Re-seed dev DB after the change (`pnpm db:seed`) — consistent with the `submission_unification` note that dev DB needs reseeding.

**Step 5 — commit:** `chore(seed): re-author checker/interactive problems for DOMjudge protocol`

**Phase 2 acceptance:** checker + interactive integration tests pass on real Docker; a validator that reads `score.txt` yields partial scores; student feedback shows `teamMessage` only, staff sees `judgeMessage`; K8s checker uses a separate validator Job and K8s interactive is gated to Docker; existing demo checker/interactive problems re-authored and re-seeded; `grep -rn testlib apps packages infra docs --include=*.{ts,svelte,json,md} | grep -v plans/completed` returns nothing; unit/typecheck/lint green.

---

## Phase 3: Judge scripts → MinIO

> **This is the Q6 item — moving the checker & interactor scripts out of the Postgres `Problem.judgeConfig` JSON column into object storage**, so they stop being the one file-type still stored as a DB string (testcases, workspace files, images, tarballs are already in MinIO).

**Depends on:** Phase 2 (validator field naming settled). With DOMjudge, "checker" and "interactor" collapse into one *validator* concept — a problem is either a `checker` or an `interactive` problem (by `judgeType`), never both, so the two legacy fields (`checkerScript`, `interactorScript`) become a single `validatorScript` stored at a single `validatorKey`. The data migration moves whichever of the two was populated into MinIO. (Open decision #3: keep two columns instead — only if you want to preserve the checker/interactor split at the storage layer; default is unify.)

### Task 3.1: Schema + migration — validator content key

**Files:**
- Modify: `packages/db/prisma/schema/problem.prisma` — add `validatorKey String?` on `Problem` (mirror `ProblemWorkspaceFile.contentKey`); the `judgeConfig` JSON keeps only `validatorLanguage` + `type`, no script body.
- Create: migration `packages/db/prisma/migrations/<ts>_judge_validator_blob/` — add column; data migration moves existing `judgeConfig.checkerScript`/`interactorScript` strings into MinIO via `putText` and records the key. (Write a one-off node script under `scripts/` for the data move; run under `pnpm db:migrate` flow.)
- Modify: `packages/storage/src/keys.ts` — add `validatorKey(problemId)`.

**Step 5 — commit:** `feat(db): store judge validator in object storage (validatorKey)`

### Task 3.2: Read path — fetch validator from storage when building the request

**Files:**
- Modify: `packages/domain/src/submission/queries.ts:404-405` — replace inline `checkerScript`/`interactorScript` reads with a `getText(validatorKey)` fetch (only when `judgeType !== "standard"`).
- Modify: `apps/worker/src/activities/judge.ts:163-170` — pass the fetched validator content into the request (or have the executor fetch it; keep the fetch in the domain/activity layer, not the workflow).
- Test: integration test that a checker problem still judges after the move.

**Step 5 — commit:** `feat(judge): load validator from storage at judge time`

### Task 3.3: Write path + cleanup

**Files:**
- Modify: the problem-edit save path (`apps/web/src/routes/(app)/problems/[problemId]/edit/+page.server.ts` and the judge-config mutation in `packages/domain/src/problem/mutations.ts`) — upload validator via `putText`, store the key; `deleteBlob` on removal.
- Modify: `packages/core/src/schemas/judge-config.ts` — remove `checkerScript`/`interactorScript`/`interactorLanguage`; keep `validatorLanguage`.
- Remove now-dead inline-script plumbing across `SandboxRequest.judgeConfig` etc.

**Phase 3 acceptance:** no judge script content stored in Postgres (`grep` the schema/JSON path); checker problem round-trips edit→judge; migration verified on a seeded DB; unit/integration green.

---

## Phase 4: TA base image + zip scaffold + tutorial

**Depends on:** Phase 2 protocol.

### Task 4.1: Official advanced base image

**Files:**
- Create: `infra/docker/advanced-base/Dockerfile` (per language, e.g. `python3.12`) — hardened non-root base, plus a small `nojv_grader` library: reads `/workspace/meta.json` + iterates `submission/`, exposes `write_result(score, verdict, feedback, testcases)` (emits the canonical long-form verdict so TAs can't get the enum wrong), and a `safe_run(cmd, stdin, timeout)` helper that runs student code **without exposing baked-in testcases** (run student code in a working dir that doesn't include the test data).
- Create: build/publish wiring in `infra/gcp/cloud-build/` (or document `docker build && push` to the project registry).

**Step 5 — commit:** `feat(judge): official advanced-mode base image with nojv_grader helper`

### Task 4.2: Downloadable zip scaffold (primary TA path)

**Files:**
- Create: `apps/web/src/routes/api/problems/advanced-scaffold/+server.ts` (or a static asset) serving a zip containing: a pre-filled `Dockerfile` (`FROM <registry>/nojv-advanced-base:python` already set — TA never types FROM), `grader.py` using `nojv_grader`, a `testcases/` example layout, and a `README` with the two build/upload commands.
- Modify: `ContainerContractSection.svelte` — add a "Download starter project" button alongside the existing copy buttons; keep the inline examples as reference.
- i18n keys for the new button/tutorial.

**Step 5 — commit:** `feat(web): downloadable advanced-mode starter scaffold`

### Task 4.3: Tutorial doc for power users

**Files:**
- Modify: `docs/architecture/JUDGE_PIPELINE.md` (or a new linked runbook) — "Authoring an advanced judge image" covering: the `/workspace` contract, `result.json` schema (canonical verdicts), building from the base image, building from scratch (`FROM` explained), and `--network none` constraint.

**Phase 4 acceptance:** downloaded scaffold builds and produces a valid `result.json` end-to-end on a real advanced submission; docs link resolves.

---

## Phase 5: Advanced-mode hardening + K8s advanced support

### Task 5.1 (5a — ship with this epic): Advanced container hardening

Close the Q3-ledger items: unbounded writable host bind mount (host-disk DoS), no `--user`, no CPU rlimit.

**Files:**
- Modify: `apps/worker/src/services/advanced-mode-executor.ts:131-152`:
  - Replace the raw `-v workspaceDir:/workspace` (rw, 0777, unbounded) with a **size-bounded writable area**: keep `submission/` + `meta.json` read-only, mount `output/` as a bounded tmpfs (e.g. `--tmpfs /workspace/output:rw,size=64m`) that the worker reads `result.json` from — OR keep the bind mount but add a disk-usage guard (`du` poll → kill on exceed). Prefer bounded tmpfs for output + read-only `submission`.
  - Add `--read-only` rootfs (TA images write only to the bounded output tmpfs + their own tmpfs).
  - Consider `--user` — but advanced images are TA-trusted and may need their own user; gate behind a per-problem flag or document the trade-off. Default: leave image's user but document.
- Modify: `apps/sandbox-runner` standard run wrapper + advanced — add `ulimit -t <cpuSeconds>` (CPU-time rlimit) alongside the existing `ulimit -u` (`apps/sandbox-runner/src/utils.ts:withProcessLimit`), derived from the wall-clock limit + headroom, as defense-in-depth against wall-clock-only TLE.
- Test: unit test the arg building; integration test that a TA image filling the disk is bounded/killed rather than OOMing the host.

**Step 5 — commit:** `fix(judge): bound advanced output, read-only rootfs, CPU rlimit`

### Task 5.2 (5b — STANDALONE, can defer): K8s advanced support

Today `K8sExecutor.execute` rejects advanced mode (`k8s-executor.ts:51-58`) because it can't `docker load` a tarball. Real fix: registry-pull model.

**Design (write a dedicated sub-plan when starting):**
- Require advanced images to be **pushed to a registry** the cluster can pull (the tarball-upload path becomes a "we build & push for you" step, or TAs push directly).
- `K8sExecutor` creates a Job using `advancedImageRef` as the pod image, mounting the `/workspace` ConfigMap/emptyDir per the advanced contract, with the same hardening + `--network none` via NetworkPolicy.
- This is a multi-day effort (registry auth, image provenance, build pipeline). **Track as a separate plan; not required to ship Phases 0–5a.**

**Phase 5 acceptance (5a):** advanced disk-fill bounded; CPU rlimit enforced; unit/integration green. (5b tracked separately.)

---

## Cross-cutting: verification & docs

- After each phase: `pnpm typecheck && pnpm lint && pnpm test:unit`. Phases touching the sandbox (1, 2, 5a) also need `pnpm sandbox:build` + a **real** judging run (mocked tests miss docker-arg bugs — `seccomp_default_judging_footgun`).
- Update `docs/architecture/JUDGE_PIPELINE.md` and `docs/operations/SECURITY.md` as behavior lands (keep docs aligned with code per the repo's doc rules).
- `docs/operations/QUALITY_SCORE.md` — tick off the Q3-ledger items as they close.
- Use `superpowers:requesting-code-review` before merging the isolation phases (security-sensitive).

## Open execution-time decisions (resolve when reached, don't block planning)

1. Phase 1.3: separate `RawCaseRun[]` field vs internal sentinel verdict — prefer the separate field.
2. Phase 2.3: validator invoked per-case vs per-submission batch — prefer per-submission batch.
3. Phase 3: single `validatorScript`/`validatorKey` vs keep checker+interactor split — prefer single.
4. Phase 5.1: `--user` on advanced containers — default leave image user, document; revisit if a concrete escape is shown.
