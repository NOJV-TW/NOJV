# Browser checker and interactive Test: implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task by task.

**Goal:** Checker and interactive problems get Test verdicts computed entirely in the browser. The browser compiles and runs the problem's own checker or interactor. The server keeps only a source read endpoint. The server-side half of #641 and the `hidden` workspace visibility go away, with no feature flag, no fallback and no dead code left behind.

**Spec:** `docs/superpowers/specs/2026-10-07-browser-test-judge-programs-design.md`.

**Owner decisions (2026-10-07):**

- No authoring check and no notice beyond a single "students can read this program" line; authors test their own problems.
- Interactive ships together with checker. No "not available yet" state.
- Judge programs compile in the student's browser. No test worker.
- No `TEST_JUDGE_ENABLED` and no fallback.
- Endpoint authorization is problem view access.
- Mobile follows the existing toolchain preload.
- The "Judged on the server" badge and the busy banner go.

**Upstream gate:** merge only after a `@wasm-oj` release with browser `interact` passing `startupEntropyBytes` (new forge PR), #93 (Python interactors) and #95 (interactive metering). Until then, develop against locally built forge packages. Never patch forge inside NOJV.

**Branch:** `feat/browser-test-judge`, cut from origin/main.

---

## Task 0: Forge PR (parallel, outside NOJV)

- Branch from forge `main` in the session scratchpad's forge clone.
- In `src/runtime/runner.worker.ts` `interactiveCoreProgram`, pass `startupEntropyBytes: prepared.startupEntropyBytes`.
- Add a browser test that runs `interact` end to end. A C interactor is enough. Use the repo's existing browser test harness, e.g. the strict-CSP suite or the Vitest browser setup.
- Open the PR from TakalaWang/forge; CODEOWNERS requests JacobLinCool.
- Comment on #93 and #95 that NOJV now needs them for browser interactive Test.

## Task 1: Remove the server side

Reapply commit `6bdacae9` from `feat/test-execution-only` with `git cherry-pick -n`, then review every hunk. It removes:

- the test worker, its workflows, queue partitions, chart and image layers, plus `@wasm-oj/server` and its patch;
- the Test API, the Redis lock, the limiter and the application test-judge module;
- `TEST_JUDGE_ENABLED`;
- the core request, record and cache-key code, and `build-artifact-wire`;
- the storage and Redis keys;
- the worker env vars;
- the edit page's build status and `checkSamples` action;
- their tests.

Fix up after the cherry-pick:

- **Restore in core** what the browser needs:
  - `judge/test-judge-verdict.ts` (`checkerCaseVerdict`, `interactiveCaseVerdict`, `truncateUtf8`);
  - `judge/wasm-oj-verdict.ts`;
  - `judge/python-judge-wrappers.ts`;
  - `judgeProgramCompileInput` and `JudgeProgramSource`, without `WASM_OJ_SERVER_*` or the cache key;
  - `interactiveContestantSupported`.

  Restore their tests too: `test-judge-verdict`, `wasm-oj-verdict`, `judge-program-sources`, and the compile-input part of `test-judge-program`.

- **Capability:** keep a simplified `staticTestCapability({ isSpecialEnv })`, or inline it if it is only `special_env`. Make sure nothing still takes `testJudgeEnabled` or `judgeLanguage`.
- **WEB-05 coverage:** move the contest participation and contest-window cases from the deleted `test-judge-domain.test.ts` (lines 527–715 on main) onto `listCodeDrafts`.
- **`assertProblemContextAllowed`:** keep it unexported unless something outside `code-draft.ts` uses it.
- **Lockfile:** `pnpm install --frozen-lockfile` must pass with a minimal lock diff.
- **Renovate:** restore what `.github/renovate.json` said about `@wasm-oj/*` before #641, and drop the rust-image rule.
- **Messages:** delete the keys only the removed UI used: `admin_checkSamples*`, `admin_checkingSamples`, `admin_judgeProgram*`, `admin_testJudgeDisabled`, `admin_testPythonInteractorUnsupported`, `editor_testJudgeBusy`, `editor_testTooLarge`, `editor_judgingOnServer`, `editor_judgedOnServer`. Grep each key before deleting it.

## Task 2: Judge-program source endpoint

- **Application:** add `getJudgeProgramSource(userId, problemId, context)` next to the problem queries, not in a new test-judge module.
  - Authorization is the same view access the problem page uses for that context.
  - The source is read through the verified script pointer.
  - It returns `{ role, language, source, sha256 }`, or 404 for standard and `special_env` problems.
- **Web:** add `apps/web/src/routes/api/problems/[id]/judge-program/+server.ts`, using `apiHandler` with the standard limiter. Parse the context the way `/api/drafts` does.
- Register the route in `tests/unit/security/exam-confinement-api-allowlist.test.ts` as `exam-scoped`.
- **Tests:** application cases for practice, assignment membership, a running exam, an ended exam or contest where the problem is still viewable, a forbidden context, 404s, and a corrupt pointer. Add an HTTP integration test for the route.

## Task 3: Browser judge-program preparation

- **New `apps/web/src/lib/services/judge-program.ts`:**
  - `prepareJudgeProgram(problemId, context)` fetches the source and builds `judgeProgramCompileInput(source, WASM_OJ_LIBCXX_PCH_HEADER)` with the shared browser engine;
  - the result is memoized per `problemId` + `sha256` for the page session;
  - it exposes progress and returns `{ ok: true, artifact } | { ok: false, diagnostics }`.
  - It preloads the judge program's toolchain(s) alongside the student's: clang for C++, the Python runtime for Python.
  - On each editor mount it refetches the source and rebuilds only if `sha256` changed.
- **`Editor.svelte` and `EditorActionBar.svelte`:**
  - start preparation in the existing toolchain-preload effect;
  - the Test button shows a preparing label (reuse the toolchain progress style) and waits;
  - a build failure disables Test with "This problem's checker/interactor failed to build", and the panel shows the diagnostics;
  - a fetch failure disables Test with "Couldn't load this problem's checker/interactor" after the existing retry pattern.
- **Tests:**
  - unit tests for the service with a fake engine and fetch: Python, C++, a failing build, memoization and a `sha256` change;
  - component tests for the button states.

## Task 4: Browser checker Test

- **`browser-local-run.ts`:** add `runBrowserChecker(artifact, { input, answer, output, timeLimitMs })`:
  - args `/judge/input /judge/answer /judge/feedback`;
  - files `/judge/input`, `/judge/answer` and `/judge/feedback/.keep`;
  - stdin = the student's output;
  - output path `/judge/feedback/teammessage.txt`;
  - `validatorTimeoutMs`, 512 MiB;
  - result mapped through `checkerCaseVerdict`.
- **`use-editor-run.svelte.ts`:**
  - Delete `requestTestJudge` use, the server error codes, `TEST_DISABLING_CODES`, `UNJUDGED_SAMPLE_CODES`, `serialiseBuildArtifact` and `MAX_CASE_STDOUT_BYTES` truncation.
  - Checker path: compile, run the samples, then run the checker on every sample that exited normally. Map run cases to samples by input, as today. Custom cases stay execution-only.
- **`submission-service.ts`:** delete `requestTestJudge` and `testJudgeErrorCode`.
- **`EditorBottomPanel.svelte`:** remove the server badge and the `serverNotice` banner. Gate the SE explanation on a browser "judged" flag. Keep the `teammessage` and Executed blocks.
- **`apps/web/src/lib/types/index.ts`:** drop `serverJudged` and `serverNotice`. The transcript type becomes local if the core schema is gone.
- **Tests:**
  - `editor-client-test`: replace the server-request cases with browser AC, WA and SE, plus custom execution-only cases;
  - `editor-output-comparison`: drop the server badge and notice cases;
  - add a unit test for `runBrowserChecker` wiring.

## Task 5: Browser interactive Test

- **`browser-local-run.ts`:** add `runBrowserInteraction(contestant, interactor, { interactorInput, limits })` with `engine.interact`. Use the contestant limits and the official interactor limits, and map through `interactiveCaseVerdict`. A wall-limit stop is TLE. Cap the transcript (move `TEST_JUDGE_TRANSCRIPT_BYTES` into web if core no longer needs it).
- **`use-editor-run.svelte.ts`:** the interactive path compiles the contestant, then runs every selected sample (`interactorInput`) and every custom case through the interactor.
- **Custom cases on interactive problems:** the case editor's input field is the interactor input. Use the existing interactor-input label and the `customCasesAllowed` switch. Reword `editor_interactiveTestNote` so it no longer says custom cases are impossible.
- JS/TS contestants stay disabled with the existing reason (`interactiveContestantSupported`).
- **Tests:**
  - unit tests for the interaction wiring with a fake engine;
  - component tests for the transcript and for interactive custom cases;
  - the real browser check in Task 8.

## Task 6: Judge-tab note

Add one line in the checker and interactor sections of `JudgeTab.svelte`, editors only: "Students can read this program when they press Test." Reword `admin_checkerHelpBody` and `admin_interactorHelpBody` so they no longer imply the program only ever runs in an isolated container. Add a small component test (none exists for `JudgeTab`).

## Task 7: Remove `hidden` workspace visibility

- **Migration:** follow `20260708000000_drop_userstatus_disabled`:
  1. `UPDATE … SET visibility='readonly' WHERE visibility='hidden'`;
  2. create the new enum;
  3. `ALTER COLUMN … USING`;
  4. rename;
  5. drop the old enum.

  Add the `-- expand-contract-ok:` line for `scripts/check-migrations.mjs`.

- **Schema and docs:** update `problem.prisma` and regenerate `DATABASE.generated.md`.
- **Core:** `workspaceFileVisibilitySchema` becomes `["editable", "readonly"]`. The judge-snapshot parser maps a legacy `hidden` to `readonly`, and drops its duplicate pointer schema if one still exists.
- **Application:** drop the content blanking in `details.ts` and the type in `workspace.ts`.
- **UI:**
  - `StudentProblemView.svelte`: lock prefix, third badge option and hidden placeholder;
  - `editor-bindings.ts`: the filter becomes language-only; rename `publicFiles`;
  - `ReferenceSolutionSection.svelte`: the filter;
  - `WorkspaceFileEditor.svelte`: the option and type;
  - `WorkspaceFileList.svelte`: the fallback icon;
  - `WorkspaceFilesSection.svelte`: the warning;
  - `types/index.ts`.
- **Messages:** delete `admin_fileHidden`, `admin_workspaceHiddenTestNote`, `workspace_fileHidden*` and `workspace_visibilityHidden`. Reword `admin_workspaceFilesHintMultiFile` and `problemDetail_multiFileHelp`.
- **Tests:**
  - fixtures in `merge-sandbox-sources`, `db-read-model` (the blanking test goes), `problem-page-data`, `problem-queries`, `editor-workspace-parity`, `workspace-section`, `editor-client-test` and `tests/e2e/course-problem-library.test.ts`;
  - a migration test;
  - a legacy snapshot test.

## Task 8: Docs, decisions, verification

**Decisions:**

- JDG-15 is rewritten per the spec.
- JDG-26, SEC-15 and OPS-21 are withdrawn. Keep each heading and index line; `27fd8226` has the format.
- JDG-05 is scoped to official judging.
- Edit JDG-12, PRB-03, PRB-22, WEB-05 and OPS-18.
- PRB-01 and PRB-09 drop `hidden`.
- Every ID token in the README must still match a heading (`tests/unit/docs/doc-links.test.ts`).

**Living docs:**

- `ARCHITECTURE.md`, `JUDGE_PIPELINE.md` (Test sections and the visibility table), `FRONTEND.md`, `REDIS.md`, `DATABASE.md`;
- `DEPLOYMENT.md`, `RELIABILITY.md`, `SECURITY.md`, `THREAT_MODEL.md`;
- `QUALITY_SCORE.md`: drop the server-Test items, and add the Wasm official-judging fast path as an item to evaluate;
- `PRODUCT_SENSE.md`, `docs/features/problem-test.md` (rewrite), `docs/features/contests.md`;
- runbooks `judge-queue.md` and `getting-started.md`;
- the READMEs of the worker, chart, storage and temporal, and `.env.example`.

Delete this plan and the spec.

**Verification:**

1. `pnpm ci:verify` (long; run it in the background with a long timeout), `pnpm lint:helm` and `pnpm install --frozen-lockfile`.
2. Run the touched integration tests against an isolated Postgres and Redis.
3. **Browser check** on a seeded local stack: the worktree dev server on port 5174 with an isolated database, and forge built locally until the release, then the release. Take screenshots.
   - `any-two-sum` and `shortest-route-plan`: AC and WA, with `teammessage`.
   - A C++ checker fixture, and a broken one: Test disabled, diagnostics shown.
   - `guess-the-number`, `multi-interactive-bisect`, `noisy-oracle-hunt` and `interactive-peak` with C++ and Python contestants: AC, WA, an infinite loop that TLEs at the instruction budget, and a custom interactor input.
   - A JS contestant on an interactive problem: disabled.
   - A multi-file problem: no `hidden` option.
   - A standard problem: unchanged.
   - A student on an ended exam's problem that is still viewable: checker Test works.
4. A worker image build without the WASM-OJ layers.
5. Run `git grep` over the dead-code checklist below; expect zero hits.

## Cleanup of earlier attempts

- **Code:** the only test worker that ever landed is #641's `worker-test` Deployment. Task 1 removes it together with its `K8S_RUNTIME_CLASS_NAME` env, service account and RBAC, PDB entry, values and image layers. The gVisor executor attempt of 2026-10-07 was stopped before any commit, and its branch is deleted.
- **Production:** nothing to undo. On 2026-10-07 no `worker-test`, executor, Service or NetworkPolicy existed in production (read-only `kubectl` check), because #641 was never released.
- **Local:** after this PR merges, delete the merged or abandoned worktrees and branches:
  - `feat/checker-interactive-test` (#641);
  - `fix/source-map-js-audit` (#642);
  - `feat/test-execution-only` (stopped; its server-removal commit is reapplied in Task 1);
  - `docs/checker-interactive-test-spec`, after switching the main checkout back to `main`.

## After merge

1. Bump to the forge release, then release NOJV.
2. The seed rows need the manual admin edits #641 listed:
   - checker re-uploads for `any-two-sum`, `course-order` and `shortest-route-plan`;
   - interaction notes, interactor inputs and transcripts for the four interactive problems.

   Restate them in the PR body.

3. No backfill is needed: nothing is precompiled.

---

## Dead-code checklist (`git grep` must find nothing outside history)

| Area                    | Must be gone                                                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker                  | `WORKER_MODE.*test`, `nojv-worker-test`, `TEST_JUDGE_SLOTS`, `WASM_OJ_RUNTIME_DIR`, `WASM_OJ_TOOLCHAIN_DIR`, `WASM_OJ_CACHE_DIR`, `@wasm-oj/server`, `@wasm-oj__server`                                                                                                               |
| Temporal                | `test-judge` queue, `testJudgeWorkflow`, `testJudgeProgramBuildWorkflow`, `runTestJudgeWorkflow`, `dispatchTestJudgeProgramBuild`, `TEST_JUDGE_TASK_QUEUE`                                                                                                                            |
| Application             | `runTestJudge`, `buildTestJudgeProgram`, `withUserTestJudgeLock`, `checkSamplesWithChecker`, `getJudgeProgramStatus`, `isTestJudgeEnabled`, `TEST_JUDGE_ENABLED`                                                                                                                      |
| Storage, Redis, limiter | `test-judge-requests/`, `test-judge-programs/`, `testJudgeRequestKey`, `testJudgeProgramKey`, `testJudgeInFlight`, `rl:test-judge`, `testJudgeApiHandler`                                                                                                                             |
| Core                    | `testJudgeRequestSchema`, `testJudgeResponseSchema`, `testJudgeStoredRequestSchema`, `storedJudgeProgramSchema`, `testJudgeProgramCacheKey`, `WASM_OJ_SERVER_IDENTITY`, `serialiseBuildArtifact`, `boundedTestJudgeOutput`                                                            |
| Web                     | `requestTestJudge`, `serverJudged`, `serverNotice`, `JudgeProgramTestStatus`, `checkSamples`, `client_test_judge_program`, `editor_testUnavailableForProblem` used for checker or interactive problems                                                                                |
| Message keys            | `admin_checkSamples*`, `admin_judgeProgram*`, `admin_testJudgeDisabled`, `editor_testJudgeBusy`, `editor_testTooLarge`, `editor_judgingOnServer`, `editor_judgedOnServer`, `admin_fileHidden`, `admin_workspaceHiddenTestNote`, `workspace_fileHidden*`, `workspace_visibilityHidden` |
| Infra                   | `worker-test`, `test-executor`, `TEST_JUDGE_EXECUTOR`, `worker-test.deployment.yaml`, `infra/docker/wasm-oj-toolchains`, the WASM-OJ stages in `worker.Dockerfile`, `"hidden"` as a workspace visibility                                                                              |
