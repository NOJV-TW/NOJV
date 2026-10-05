# Checker and Interactive Browser Test Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task.

**Goal:** Make **Test** work on checker and interactive problems. The contestant compiles and runs in the browser; the checker or interactor runs only on the server, in a WASM sandbox, on a dedicated `test-judge` Temporal queue.

**Architecture:**

- The web route authorises the request with the read-only draft-scope check and writes the request (cases, uploaded contestant artifact) to object storage.
- It then executes `testJudgeWorkflow` on `test-judge` and awaits the result (30 s).
- A `WORKER_MODE=test` worker owns a pool of `@wasm-oj/server` engines. It builds the judge program from its stored source (cached in storage, content-addressed), runs it with `Engine.run` (checker) or `Engine.interact` (interactive), and returns sanitised verdicts.

**Tech Stack:** SvelteKit 2 / Svelte 5, Temporal TS SDK, Prisma 7, Zod 4, `@wasm-oj/browser` 0.2.3, `@wasm-oj/server` 0.2.3 (native `wasm-oj-compiler` / `wasm-oj-runner` built from `wasm-oj/forge` `crates/runtime-core` at tag `v0.2.3`), Helm, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-06-checker-interactive-test-design.md`.

**Out of scope:**

- Part B (precompiled native judge programs for official judging): separate plan after measuring.
- Python interactors: enabled in a follow-up once `wasm-oj/forge` releases the runtime-bundle-interactor change (local branch `feat/runtime-bundle-interactor`, commit `4a3d401`).

---

## Conventions for every task

- **Worktree:** `/Users/takala/code/NOJV/.worktrees/checker-interactive-test`, branch `feat/checker-interactive-test`.
- **TDD:** write the failing test, run it, implement, run it again, commit. Run the narrowest test command shown, then `pnpm typecheck` for touched packages.
- **Test commands** (from `docs/runbooks/testing.md`):
  - unit: `pnpm vitest run --project unit <file>`
  - component: `pnpm vitest run --project component <file>`
  - integration: `pnpm test:db:provision` once, then the env block from `testing.md` plus `pnpm vitest run --project integration <file>`
- **i18n:** after editing `apps/web/messages/{en,zh-TW}.json`, run `pnpm --filter @nojv/web paraglide:compile`.
- **New env vars:** must have `.default()` and be wired in the chart (OPS-12).
- **New registration surfaces:** need a fitness test in the same change (ENG-03).
- **Style:** no explanatory comments (AGENTS.md rule). A deliberate shortcut gets a one-line `ponytail:` comment naming its ceiling.
- **Commits:** end each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Local runtime for manual checks and the gated integration tests:**

- **Binaries:** already built at `/Users/takala/code/forge/crates/runtime-core/target/release` (darwin).
- **Toolchains:** `mkdir -p ~/.cache/nojv-wasm-oj/toolchains && cd ~/.cache/nojv-wasm-oj/toolchains && npm init -y && npm i @wasm-oj/toolchain-clang@0.2.0 @wasm-oj/toolchain-python@0.2.0`.
- **`.env`:** `WASM_OJ_RUNTIME_DIR=/Users/takala/code/forge/crates/runtime-core/target/release`, `WASM_OJ_TOOLCHAIN_DIR=$HOME/.cache/nojv-wasm-oj/toolchains`, `TEST_JUDGE_ENABLED=true`.

---

## Phase 1 — Shared contracts (`@nojv/core`, `@nojv/temporal`)

### Task 1: Move the WASM-OJ termination→verdict mapping into core

**Files:**

- Create: `packages/core/src/judge/wasm-oj-verdict.ts`
- Modify: `packages/core/src/index.ts` (export)
- Modify: `apps/web/src/lib/services/browser-local-run.ts` (`browserLocalTerminationVerdict` → import from core)
- Test: `tests/unit/core/wasm-oj-verdict.test.ts`; keep `tests/unit/web/browser-local-run.test.ts` green

**Steps:**

1. **Write the test.** Copy the termination cases that `browserLocalTerminationVerdict` handles today:
   - `instruction-limit`, `logical-time-limit` and `wall-time-limit` → TLE;
   - memory-limit terminations → MLE;
   - `exited` with code 0 → AC (the case still goes to the comparator or checker);
   - `exited` with a non-zero code, or `trap` → RE.

   Assert `wasmOjTerminationVerdict(termination, code)` returns the same verdict string the web function returns now (read `browser-local-run.ts:208-245` for the exact list).

2. **Run it.** `pnpm vitest run --project unit tests/unit/core/wasm-oj-verdict.test.ts` → FAIL (module missing).
3. **Implement.** Move the function body verbatim into core as `export function wasmOjTerminationVerdict(...)`, and make web import it. Type `termination` as `string` so core does not depend on `@wasm-oj/*`.
4. **Run both tests.** Both PASS.
5. **Commit:** `refactor(core): share the WASM-OJ termination verdict mapping`.

### Task 2: Test-judge schemas, limits and verdict merge

**Files:**

- Create: `packages/core/src/schemas/test-judge.ts`
- Create: `packages/core/src/judge/test-judge-verdict.ts`
- Modify: `packages/core/src/index.ts`
- Test: `tests/unit/core/test-judge-schema.test.ts`, `tests/unit/core/test-judge-verdict.test.ts`

**Contract:**

```ts
export const TEST_JUDGE_MAX_CASES = 15;
export const TEST_JUDGE_MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
export const TEST_JUDGE_REQUEST_BODY_BYTES = 24 * 1024 * 1024;
export const TEST_JUDGE_TRANSCRIPT_BYTES = 64 * 1024;

const text = z.string().max(200_000);
export const testJudgeCheckerCaseSchema = z
  .object({ input: text, expectedOutput: text, output: z.string().max(MAX_CASE_STDOUT_BYTES) })
  .strict();
export const testJudgeInteractiveCaseSchema = z.object({ interactorInput: text }).strict();
const uploadedArtifactSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("wasm"),
      bytesBase64: z.string().min(1),
      metadata: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({ kind: z.literal("runtime-bundle"), artifact: z.record(z.string(), z.unknown()) })
    .strict(),
]);
export const testJudgeRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("checker"),
      context: submissionContextSchema,
      cases: z.array(testJudgeCheckerCaseSchema).min(1).max(TEST_JUDGE_MAX_CASES),
    })
    .strict(),
  z
    .object({
      kind: z.literal("interactive"),
      context: submissionContextSchema,
      language: languageSchema,
      artifact: uploadedArtifactSchema,
      cases: z.array(testJudgeInteractiveCaseSchema).min(1).max(TEST_JUDGE_MAX_CASES),
    })
    .strict(),
]);
export const testJudgeCaseResultSchema = z
  .object({
    verdict: z.enum(["AC", "WA", "TLE", "MLE", "RE", "SE"]),
    teamMessage: z.string().max(MAX_FEEDBACK_LEN).optional(),
    contestantStderr: z.string().max(MAX_CASE_STDERR_BYTES).optional(),
    transcript: z.object({ toInteractor: z.string(), toContestant: z.string() }).optional(),
    timeMs: z.number().int().nonnegative().optional(),
  })
  .strict();
export const testJudgeResponseSchema = z
  .object({ cases: z.array(testJudgeCaseResultSchema) })
  .strict();
export const testJudgeErrorCodes = [
  "test_judge_unavailable",
  "test_judge_busy",
  "judge_program_build_failed",
  "judge_program_unsupported",
] as const;
```

Reuse the existing `submissionContextSchema` and `languageSchema` exports. Grep `packages/core/src/schemas/submission.ts` for the context schema's real name.

**Verdict helpers** (`test-judge-verdict.ts`):

- `checkerCaseVerdict(exitCode, teamMessage?)` wraps `parseValidatorFeedback` (`packages/core/src/judge/validator.ts`): 42 → AC, 43 → WA, anything else → SE. It drops `judgeMessage`.
- `interactiveCaseVerdict({ contestant, interactor })` mirrors `apps/worker/src/sandbox/shared/check-interactive.ts`:
  - interactor not `exited` → SE;
  - otherwise a contestant TLE/MLE/RE from `wasmOjTerminationVerdict` wins;
  - otherwise interactor 42 → AC, 43 → WA, anything else → SE.
- `truncateUtf8(text, maxBytes)` caps transcripts.

**Tests:**

- The schema rejects 16 cases.
- The schema rejects unknown keys and an interactive request without an artifact.
- Checker exit codes 42/43/1 map to AC/WA/SE.
- Interactive: contestant TLE + interactor 42 → TLE; contestant exited 0 + interactor 43 → WA; interactor `trap` → SE.
- `truncateUtf8` never splits a multibyte character.

**Commit:** `feat(core): test-judge request, response and verdict contracts`.

### Task 3: Static Test capability and the toolchain identity

**Files:**

- Create: `packages/core/src/judge/test-capability.ts`
- Test: `tests/unit/core/test-capability.test.ts`
- Test (pin guard): `tests/unit/infra/wasm-oj-pins.test.ts`

**Contract:**

```ts
export const WASM_OJ_SERVER_IDENTITY = "wasm-oj-server@0.2.3+clang@0.2.0+python@0.2.0";
export type TestCapability =
  | { available: true }
  | {
      available: false;
      reason: "special_env" | "test_judge_unavailable" | "judge_program_unsupported";
    };
export function staticTestCapability(input: {
  isSpecialEnv: boolean;
  judgeType: JudgeType;
  judgeLanguage: "cpp" | "python" | null;
  testJudgeEnabled: boolean;
}): TestCapability;
export function interactiveContestantSupported(language: Language): boolean; // false for javascript, typescript
export async function testJudgeProgramCacheKey(input: {
  language: string;
  source: string;
  role: "checker" | "interactor";
}): Promise<string>; // sha256 hex of JSON [WASM_OJ_SERVER_IDENTITY, role, language, source] via crypto.subtle
```

**Rules:**

- `special_env` → `special_env`.
- `standard` → available, even when the test judge is disabled.
- checker or interactive, with `testJudgeEnabled` false → `test_judge_unavailable`.
- interactive with a `python` interactor → `judge_program_unsupported`. Add `// ponytail: Python interactors wait for the wasm-oj/forge runtime-bundle-interactor release`.

**Pin test:** read `apps/worker/package.json` and `infra/docker/worker.Dockerfile`. Assert the pinned `@wasm-oj/server` version and the toolchain versions in the Dockerfile `npm install` line match `WASM_OJ_SERVER_IDENTITY`.

**Commit:** `feat(core): static Test capability and test-judge cache key`.

### Task 4: Queue constant and workflow I/O types

**Files:**

- Modify: `packages/temporal/src/task-queues.ts`: `export const TEST_JUDGE_TASK_QUEUE = "test-judge" as const;`
- Modify: `apps/worker/src/workflows/activity-options.ts`: add the literal `TEST_JUDGE_QUEUE`, as the file does for the others.
- Modify: `packages/core/src/workflow-types.ts`:

```ts
export interface TestJudgeWorkflowInput {
  requestKey: string;
}
export interface TestJudgeProgramBuildInput {
  problemId: string;
}
export type TestJudgeWorkflowOutput =
  | { ok: true; cases: TestJudgeCaseResult[] }
  | { ok: false; code: (typeof testJudgeErrorCodes)[number]; detail?: string };
```

- Test: extend `tests/unit/worker/workflow-registration.test.ts` only after Task 9 adds the dispatch calls; nothing to test here.

**Commit:** `feat(temporal): test-judge queue and workflow types`.

---

## Phase 2 — Data model and authoring

### Task 5: `interactorInput` on samples

Template: commit `69cc964f` (#638, `explanation`). Touch the same files.

**Files:**

- `packages/core/src/schemas/problem.ts:37`: `interactorInput: z.string().max(200_000).optional()`
- `packages/application/src/submission/judge-context.ts:85`: keep stripping samples to `{input, output}` for official judging; Test must not leak through the judge snapshot.
- `packages/application/src/problem/details.ts`, `apps/web/src/lib/types/index.ts` (`ProblemDetail.samples`)
- `packages/application/src/problem/mutations/records.ts` (`updateProblemRecord`):
  - When `payload.samples` is set, parse the stored `judgeConfig` with `parsePersistedJudgeConfig`.
  - If it is `interactive` and a sample's `interactorInput?.trim()` is empty, throw `ValidationError("Every interactive sample needs an interactor input.")`.
  - Use `target.id` semantics when publishing forks (records.ts:397).
- `packages/db/prisma/seeds/problems.ts` (`SeedProblemSample`, `toSamplesJson`)
- `docs/architecture/DATABASE.md`: the samples JSON row

**Tests:**

- `tests/unit/application/judge-context.test.ts`: `interactorInput` is stripped.
- New integration test `tests/integration/application/problem-samples-interactor-input.test.ts`:
  - interactive problem, a sample without `interactorInput` → `ValidationError`;
  - with it → saved;
  - checker problem → not required.

**Commit:** `feat(problems): interactor input on interactive samples`.

### Task 6: `ProblemStatement.interactionFormat`

**Files:**

- `packages/db/prisma/schema/problem.prisma` (`ProblemStatement`): `interactionFormat String @default("") @db.Text`
- Migration `packages/db/prisma/migrations/20261006120000_problem_statement_interaction_format/migration.sql`:

  ```sql
  ALTER TABLE "ProblemStatement" ADD COLUMN "interactionFormat" TEXT NOT NULL DEFAULT '';
  ```

  Run `pnpm db:generate`, then `pnpm db:docs` (CI fails on `DATABASE.generated.md` drift).

- Core:
  - `problemCreateObjectSchema` (problem.ts:85) and `problemBasicInfoSchema` (:164): `interactionFormat: z.string().trim().max(8_000, "validation_tooLong").default("")`
  - `problemUpdateSchema` if it lists statement fields
- Application: `records.ts:47-51, 90-94, 239-243, 427-445` (create and upsert), `details.ts:23,123` (`interactionFormat: statement?.interactionFormat ?? ""`), `fork.ts:118-123`
- Web: `apps/web/src/lib/types/index.ts`, edit loader `routes/(app)/problems/[problemId]/edit/+page.server.ts:70`
- Docs: `docs/architecture/DATABASE.md` (ProblemStatement table)

**Tests:**

- An integration test that a fork copies `interactionFormat`.
- An update round-trip in the existing problem-records integration test file (find it with `rg -l updateProblemRecord tests/integration`).

**Commit:** `feat(problems): interaction notes for interactive statements`.

### Task 7: Authoring UI for interactor input and interaction notes

**Files:**

- `apps/web/src/lib/components/features/problem/statement/SamplesEditor.svelte`:
  - New prop `judgeType: JudgeType | undefined`.
  - When it is `"interactive"`, render a required "Interactor input" textarea per sample (`m.problemEditor_sampleInteractorInput()`, helper text `m.problemEditor_sampleInteractorInputHelp()`).
  - Relabel input/output to "Transcript: interactor lines" / "Transcript: your lines".
- `apps/web/src/lib/components/features/problem/tabs/BasicInfoTab.svelte`:
  - Pass `judgeType` (read it from the edit page data's `judgeConfig.type`).
  - Add an "Interaction notes" Markdown field next to `inputFormat` (:324-349), shown only for interactive problems.
- Display:
  - `apps/web/src/lib/components/features/problem/left-panel/ProblemDescriptionPanel.svelte:113-173`
  - `.../layouts/MobileWorkspaceBlocker.svelte:72-120`
  - `routes/(app)/problems/[problemId]/edit/+page.svelte` (read-only samples)
  - Show the "Interaction" section and each sample's interactor input when present.
- Messages: `problemEditor_*`, `problem_interaction*` keys in `en.json` and `zh-TW.json`.
- Tests:
  - Extend `tests/component/web/problem-description-panel.test.ts`: the interactor input and the interaction section render for interactive problems only.
  - Add a SamplesEditor component test: the field appears only when `judgeType="interactive"`.

**Commit:** `feat(web): author and show interactor inputs and interaction notes`.

---

## Phase 3 — Worker `test` mode

### Task 8: Worker dependencies, env and the runtime loader

**Files:**

- `apps/worker/package.json`: add `"@wasm-oj/server": "0.2.3"` (exact pin), then run `pnpm install`. Toolchains are **not** worker dependencies; they live in `WASM_OJ_TOOLCHAIN_DIR` so the app layer stays small.
- `apps/worker/src/env.ts`:
  - `WORKER_MODE: z.enum(["all", "judge", "platform", "test"])`
  - `WASM_OJ_RUNTIME_DIR: z.string().default("")`
  - `WASM_OJ_TOOLCHAIN_DIR: z.string().default("")`
  - `WASM_OJ_CACHE_DIR: z.string().default("/tmp/wasm-oj")`
  - `TEST_JUDGE_SLOTS: z.coerce.number().int().min(1).max(8).default(2)`
- Create `apps/worker/src/test-judge/runtime.ts`:
  - `loadServerToolchains(dir)`: dynamic `import(pathToFileURL(join(dir, "node_modules/@wasm-oj/toolchain-clang/dist/index.js")).href)`, the same for python, and return `[clang.serverSource(), python.serverSource()]`.
  - `createEnginePool(env)`: `TEST_JUDGE_SLOTS` × `createServerEngine({ runtimeDirectory, toolchains, cacheDirectory: join(cacheDir, String(i)) })`, with `acquire(): Promise<{ engine, release }>` (FIFO waiters). `ServerRunner` accepts one operation at a time, so each engine is used by one activity at a time.
- `apps/worker/src/otel.ts:84-86` and `mailer-startup.ts:5-6`: handle `test` (service name `nojv-worker-test`; no mailer).

**Tests:**

- `tests/unit/worker/env.test.ts`: defaults, and `WORKER_MODE=test` parses.
- `tests/unit/worker/test-judge-engine-pool.test.ts`: the pool with fake engines serialises per engine, serves waiters in order and releases on throw.

**Commit:** `feat(worker): test mode env and WASM-OJ engine pool`.

### Task 9: Judge program build and cache

**Files:**

- Create `apps/worker/src/test-judge/judge-program.ts`
- Copy the wrappers: `apps/worker/assets/test-judge/python-validator.py` and `python-interactor-domjudge.py`, byte-identical to `apps/sandbox-runner/assets/wrappers/*`. Add a unit test that asserts the copies are identical, so they cannot drift.
- Copy the C++ shim source: move `CPP_STANDARD_HEADER` from `apps/web/src/lib/services/browser-local-run.ts` into `packages/core/src/judge/cpp-standard-header.ts`. Export it plus `WASM_OJ_PCH_PATH = "wasm-oj.pch.hpp"`. Web and worker both import it, and `WASM_OJ_LIBCXX_PCH_HEADER` stays sourced from `@wasm-oj/*` in each app.

**Behaviour:**

```ts
export async function getJudgeProgram(
  engine,
  { role, language, source },
): Promise<{ ok: true; artifact: BuildArtifact } | { ok: false; diagnostics: string }>;
```

1. `key = await testJudgeProgramCacheKey(...)`.
2. Storage object `test-judge-programs/${key}.json` (via `@nojv/storage` `getText`/`putImmutableText`) holds either `{ status: "ok", artifact: <serialised> }` or `{ status: "failed", diagnostics }`. Serialise Wasm bytes as base64.
3. On a miss, compile:
   - python: `{ language: "python", entry: "main.py", files: { "main.py": wrapper + source } }`
   - cpp: `{ language: "cpp", entry: "main.cpp", files: { "main.cpp": source, "src/bits/stdc++.h": CPP_STANDARD_HEADER, [WASM_OJ_PCH_PATH]: WASM_OJ_LIBCXX_PCH_HEADER } }`

   Store the result.

4. Diagnostics are capped at 4 KiB.
5. Add `// ponytail: content-addressed objects are never collected; add a prefix sweep if the bucket grows`.

**Tests:**

- `tests/unit/worker/test-judge-program.test.ts` with a fake engine and in-memory storage:
  - a cache hit skips compile;
  - a failed build is cached and returned;
  - the python wrapper is prepended;
  - cpp gets the shim.
- Gated `tests/integration/worker/test-judge-runtime.test.ts`, `describe.skipIf(!process.env.WASM_OJ_RUNTIME_DIR)`, with a real engine: the cpp checker from the spike (`exit 42/43`, teammessage) and a python checker.

**Commit:** `feat(worker): build and cache test-judge programs`.

### Task 10: Test-judge activities and workflows

**Files:**

- Create `apps/worker/src/activities/test-judge.ts`:
  - `runTestJudge({ requestKey }) → TestJudgeWorkflowOutput`:
    - Read and `JSON.parse` the request blob written by web (Task 12; its shape is `TestJudgeStoredRequest`, defined in core next to Task 2's schemas).
    - Delete the blob in `finally`.
    - Acquire an engine and get the judge program; a build failure returns `judge_program_build_failed`.
  - Checker: for each case, `engine.run(checker, { args: ["/judge/input", "/judge/answer", "/judge/feedback"], stdin: case.output, files: { "/judge/input": case.input, "/judge/answer": case.expectedOutput, "/judge/feedback/.keep": "" }, outputPaths: ["/judge/feedback/teammessage.txt"], env: runtimeEnv, resources: { logicalTimeLimitMs: 30_000, memoryLimitBytes: 512 MiB } })` → `checkerCaseVerdict`.
  - Interactive:
    - Rebuild the contestant artifact. For Wasm, use `{ ...metadata, kind: "wasm", bytes: Buffer.from(bytesBase64, "base64") }`; reject decoded bytes over `TEST_JUDGE_MAX_ARTIFACT_BYTES`. For a runtime bundle, use the stored object.
    - Then per case: `engine.interact(contestant, interactor, { contestant: { env: runtimeEnv, resources: { logicalTimeLimitMs: effectiveTimeLimitMs(timeLimitMs, language), memoryLimitBytes: memoryLimitMb * MiB, wallTimeLimitMs: 10_000 } }, interactor: { args: ["/judge/input", "/judge/answer", "/judge/feedback"], files: { "/judge/input": case.interactorInput, "/judge/answer": "", "/judge/feedback/.keep": "" }, resources: { logicalTimeLimitMs: 30_000 } } })` → `interactiveCaseVerdict`.
    - Transcript truncated with `truncateUtf8`. Contestant stderr is capped. Interactor stderr is dropped.
  - Any engine throw for one case → SE for that case, with no message leaked.
  - `buildTestJudgeProgram({ problemId })`: load the problem's judge script through `@nojv/application` (use the existing hydrate function behind `problem/blobs.ts:191 hydrateValidatorScripts`), then `getJudgeProgram`. Discard the result; it only warms the cache.
- Create `apps/worker/src/activities/test-judge-bundle.ts` (re-export barrel), and add it to `QUEUE_BUNDLES` in `tests/unit/worker/activity-bundle-registration.test.ts`.
- Create `apps/worker/src/workflows/test-judge.ts`:
  - `testJudgeWorkflow` (one activity on `TEST_JUDGE_QUEUE`, `startToCloseTimeout: "28s"`, `retry: { maximumAttempts: 1 }`)
  - `testJudgeProgramBuildWorkflow` (`startToCloseTimeout: "5m"`, `maximumAttempts: 3`)
  - Export both from `workflows/index.ts`.
- `apps/worker/src/worker-app.ts`: a `mode === "test"` branch:
  - Fail fast if `WASM_OJ_RUNTIME_DIR` or `WASM_OJ_TOOLCHAIN_DIR` is empty.
  - Create the pool, then a Worker on `TEST_JUDGE_TASK_QUEUE` with `workflowsPath`, `activities: testJudgeActivities`, `maxConcurrentActivityTaskExecutions: env.TEST_JUDGE_SLOTS` and `maxCachedWorkflows: 16`.
  - `all` mode includes it only when `WASM_OJ_RUNTIME_DIR` is set.
- Update `tests/unit/worker/worker-app.test.ts:209-220` queue lists.

**Tests:**

- Unit `tests/unit/worker/test-judge-activity.test.ts` with fake engine and storage:
  - a checker 42 → AC with teamMessage, `judgemessage` never returned;
  - interactive contestant TLE wins;
  - an oversized artifact → SE;
  - the blob is deleted on success and on throw.
- Extend the gated integration test from Task 9: a cpp interactor with a cpp contestant compiled by the same engine (the spike sources) → AC with transcript.

**Commit:** `feat(worker): run test-judge requests on a dedicated queue`.

### Task 11: Temporal partitions

**Files:** add `test-judge` to both partition lists in:

- `infra/docker/temporal-dynamic-config.yaml`
- `infra/flux/temporal-values.yaml`
- `infra/gcp/gke/temporal/helm-values.ha.yaml`

```yaml
- value: 1
  constraints: { taskQueueName: test-judge }
```

**Test:** add `tests/unit/infra/temporal-queue-partitions.test.ts`. It parses the three files and asserts every exported `*_TASK_QUEUE` from `@nojv/temporal` (except the platform queue if it is intentionally absent; check the files) has write and read partition `1`. This is the fitness test ENG-03 requires for JDG-12.

**Commit:** `chore(temporal): single partition for the test-judge queue`.

---

## Phase 4 — Orchestration, application and API

### Task 12: Await a workflow result from web

**Files:**

- `packages/temporal/src/dispatch.ts`:
  - `runTestJudgeWorkflow(input, { timeoutMs })`:

    ```ts
    const client = await getTemporalClient();
    try {
      return await client.workflow.execute("testJudgeWorkflow", {
        taskQueue: TEST_JUDGE_TASK_QUEUE,
        workflowId: `test-judge-${randomUUID()}`,
        args: [input],
        workflowExecutionTimeout: `${timeoutMs}ms`,
      });
    } catch (error) {
      if (error instanceof WorkflowFailedError) return { ok: false, code: "test_judge_busy" };
      throw error;
    }
    ```

  - `dispatchTestJudgeProgramBuild({ problemId }, generation)`: `startUnlessRunning(client.workflow.start("testJudgeProgramBuildWorkflow", { taskQueue, workflowId: \`test-judge-build-${problemId}-${generation}\`, args: [{ problemId }] }))`.
- `packages/temporal/src/orchestration-adapter.ts` and `packages/application/src/shared/orchestration.ts` (`DomainOrchestrationAdapter`): add `runTestJudge` and `dispatchTestJudgeProgramBuild`. Update every test double that implements the interface (`rg -l "DomainOrchestrationAdapter" tests`).
- `tests/unit/worker/workflow-registration.test.ts:34`: extend the scan to `workflow.execute("…")`.

**Tests:**

- The registration test passes and fails if the workflow name is misspelt; verify by temporarily renaming it.
- A unit test with a mocked client: `WorkflowFailedError` → `{ ok: false, code: "test_judge_busy" }`.

**Commit:** `feat(temporal): execute test-judge workflows and await the result`.

### Task 13: `testJudgeDomain` in application

**Files:**

- `packages/application/src/code-draft.ts:37`: export `assertDraftScopeAllowed`, renamed `assertProblemContextAllowed`, and keep the drafts callers. Add it to the `codeDraftDomain` barrel or a shared export.
- Create `packages/application/src/test-judge/index.ts` and export `testJudgeDomain` from `packages/application/src/index.ts`.

**`runTestJudge(actor, problemId, request, clientIp)`:**

1. If `process.env.TEST_JUDGE_ENABLED !== "true"`, throw `ServiceUnavailableError("test_judge_unavailable")`. Read it through the application env helper if one exists (grep `process.env` in `packages/application/src/shared`).
2. Call `assertProblemContextAllowed(actor, { context: request.context, problemId }, new Date(), clientIp)`.
3. Load the problem with `problemRepo.findDetailById`.
4. Parse `judgeConfig`. `request.kind` must equal the judge type, otherwise `ValidationError`.
5. If `staticTestCapability(...)` is unavailable, throw `ConflictError(reason)`.
6. Write the stored request to `test-judge-requests/${randomUUID()}.json` with `putImmutableText`, including:
   - `{ kind, judgeLanguage, judgeScriptPointer: checkerStorage | interactorStorage, timeLimitMs, memoryLimitMb, runtimeEnv: judgeConfig.runtime?.env ?? {}, contestantLanguage, cases, artifact }`.
7. `const result = await getDomainOrchestration().runTestJudge({ requestKey }, { timeoutMs: 30_000 })`.
8. Map `{ ok: false }` codes to errors:
   - `test_judge_busy` → `ServiceUnavailableError`
   - `judge_program_build_failed` → `ConflictError` carrying the code
9. Return `testJudgeResponseSchema.parse({ cases })`.

**`mapPersistedProblemDetail`** (`problem/details.ts:90`): add `testCapability: staticTestCapability({ isSpecialEnv, judgeType, judgeLanguage, testJudgeEnabled })`.

**`saveProblemJudgeConfig`** (`mutations/judge-config.ts:39`): after the transaction commits, if the new type is checker or interactive and the test judge is enabled, call `getDomainOrchestration().dispatchTestJudgeProgramBuild({ problemId }, storageGeneration).catch(log)`. This is best effort; the first Test builds on a miss anyway.

**Tests:** integration `tests/integration/application/test-judge-domain.test.ts` with a mocked orchestration adapter:

- A practice checker problem → the stored request contains the cases and the script pointer, and the orchestration is called.
- A request kind that does not match the judge type → 400.
- An exam context without an active session → `ForbiddenError`, and nothing is written.
- Disabled → `test_judge_unavailable`.
- Busy → 503.

**Commit:** `feat(application): authorise and dispatch test-judge requests`.

### Task 14: `POST /api/problems/[id]/test-judge`

**Files:**

- `apps/web/src/lib/server/shared/rate-limiter.ts`: `export const testJudgeApiRateLimiter = createRateLimiter("rl:test-judge", 30, 60);`
- `apps/web/src/lib/server/shared/api-handler.ts`: `export const testJudgeApiHandler = (h) => wrapHandler(h, testJudgeApiRateLimiter);`
- `docs/architecture/REDIS.md:105-107`: a limiter table row.
- Create `apps/web/src/routes/api/problems/[id]/test-judge/+server.ts`:

  ```ts
  export const POST: RequestHandler = testJudgeApiHandler(async (event) => {
    const actor = requireApiAuth(event);
    const request = testJudgeRequestSchema.parse(
      await readJsonBody(event, TEST_JUDGE_REQUEST_BODY_BYTES),
    );
    try {
      return json(
        await testJudgeDomain.runTestJudge(actor, event.params.id, request, getClientIp(event)),
      );
    } catch (err) {
      if (
        (err instanceof HttpError && err.status < 500) ||
        err instanceof ServiceUnavailableError
      )
        return json({ code: codeOf(err), message: err.message }, { status: err.status });
      throw err;
    }
  });
  ```

  `codeOf` maps the known messages to `testJudgeErrorCodes`.

**Tests:**

- Integration `tests/integration/http/test-judge.test.ts` using `callRoute` from `tests/integration/http/_harness.ts`, with orchestration mocked:
  - 200 golden path;
  - 401 without a user;
  - 413 for a body over 24 MiB;
  - 429 after 30 requests (dev multiplies points by 1000; mirror how `rate-limit-wrappers.test.ts` sets the limiter for tests);
  - 503 busy.
- Unit: add `testJudgeApiHandler` to `tests/unit/web/rate-limit-wrappers.test.ts`.

**Commit:** `feat(web): test-judge API route`.

---

## Phase 5 — Browser Test flow

### Task 15: Expose the compiled artifact and per-case runs

**Files:** `apps/web/src/lib/services/browser-local-run.ts`

- Split `runBrowserLocally` (:328-411) into:
  - `compileBrowserLocally(request) → { ok: true; artifact } | { ok: false; result: SubmissionResult /* compile_error */ }`
  - `runBrowserCases(artifact, cases, limits) → Array<{ verdict, stdout, stderr, timeMs, memoryKb, exitCode, termination }>`
- Keep `runBrowserLocally` as the composition, so standard Test is unchanged.
- Add `serialiseArtifactForUpload(artifact)`:
  - Wasm → `{ kind: "wasm", bytesBase64, metadata: <artifact without bytes> }`
  - runtime bundle → `{ kind: "runtime-bundle", artifact }`
- Use the shared `CPP_STANDARD_HEADER` from core (Task 9).

**Tests:** extend `tests/unit/web/browser-local-run.test.ts`:

- The standard result is identical before and after the refactor; snapshot the existing fixtures.
- Serialisation round-trips bytes.

**Commit:** `refactor(web): split browser Test into compile and run steps`.

### Task 16: Checker and interactive Test in the editor controller

**Files:**

- `apps/web/src/lib/components/features/problem/editors/use-editor-run.svelte.ts`:
  - Remove the `client_test_private_judge` branch (:124-129) and its message keys in both languages.
  - **Checker:**
    1. Compile and run locally.
    2. Cases whose local verdict is AC and that have `expectedOutput` are posted as `{ input, expectedOutput, output: stdout }` to `/api/problems/${problemId}/test-judge` with `X-Requested-With: fetch`, using the existing fetch helper used by `submission-service.ts`.
    3. Merge the returned verdict (and `teamMessage` as the case feedback) into those cases.
    4. Cases without `expectedOutput` stay execution-only.
  - **Interactive:**
    1. If `!interactiveContestantSupported(language)`, throw the code `client_test_interactive_language`.
    2. Compile locally, then post `{ kind: "interactive", language, artifact: serialiseArtifactForUpload(artifact), cases: runCases.map(c => ({ interactorInput: c.input })) }`.
    3. Map the results into the `SubmissionResult` shape, keeping the transcript on a web-only `TestCaseView` extension.
  - **Errors:** map the response codes to `messageForSubmitError` entries:
    - `test_judge_busy` → `m.editor_testJudgeBusy()`
    - `judge_program_build_failed` → `m.editor_testJudgeProgramBuildFailed()`
    - `test_judge_unavailable` / `judge_program_unsupported` → `m.editor_testUnavailableForProblem()`
  - The first-click build failure also sets a controller state `testDisabledReason` for the rest of the session.
  - **Initial run cases:** `initialSamples` (:113), for interactive problems, map to `{ input: sample.interactorInput ?? "" }` and skip samples without it.
- `Editor.svelte`: pass `problem.testCapability` and `problem.interactionFormat`.

**Tests:** extend `tests/unit/web/editor-client-test.test.ts` (mocked `browser-local-run` and fetch):

- A checker problem posts only AC cases with an expected output, and merges WA from the server.
- An interactive problem posts the serialised artifact and the interactor inputs.
- A busy response shows the busy message.
- A JS interactive contestant is blocked before compile.

**Commit:** `feat(web): run checker and interactive Test through the test judge`.

### Task 17: Button states, interactive panel and transcript

**Files:**

- `EditorActionBar.svelte`:
  - New prop `testDisabledReason: string | null`.
  - The Test button is `disabled={isRunning || disabled || testDisabledReason !== null}`.
  - `title={testDisabledReason ?? (!hasSubmittableSource ? m.editor_emptySourceTooltip() : undefined)}`.
- `Editor.svelte`: compute `testDisabledReason` from `testCapability` (special_env → `m.editor_testUnsupportedProblemType()`; unavailable or unsupported → `m.editor_testUnavailableForProblem()`), the selected language for interactive (`m.editor_testInteractiveLanguage()`), and the controller's runtime reason.
- `EditorBottomPanel.svelte`, interactive branch (:178):
  - Label the case input `m.editor_interactorInput()`.
  - Render `interactionFormat` (the same Markdown renderer the statement uses) above the case editor.
  - In the results area (:219-320), show a "Transcript" block with two monospace columns (to interactor / to you) when present.
  - Follow `docs/architecture/DESIGN.md` tokens.
- Messages in en and zh-TW, then `paraglide:compile`.

**Tests:** component tests

- `tests/component/web/editor-test-button-state.test.ts` (special_env disabled with text; interactive + javascript disabled; standard enabled)
- extend `editor-output-comparison.test.ts` for the transcript rendering and the interactor input label

**Commit:** `feat(web): Test button states and interactive transcript`.

### Task 18: Editor build status for authors

**Files:**

- Application: `testJudgeDomain.getJudgeProgramStatus(problemId)`. It hashes the stored script with `testJudgeProgramCacheKey` and reads `test-judge-programs/${key}.json`, returning `{ status: "ok" | "failed" | "pending"; diagnostics?: string }`.
- Edit loader `routes/(app)/problems/[problemId]/edit/+page.server.ts`: load it for checker and interactive problems.
- The judge-config tab component (find it via `updateJudgeConfig` in `edit/+page.svelte`): show a status line.
  - ok → "Test can run this judge program"
  - failed → "This judge program cannot run in Test: \<diagnostics\>"
  - pending → "Preparing for Test…"

**Tests:**

- An integration test of `getJudgeProgramStatus`.
- A component test of the three states.

**Commit:** `feat(web): show test-judge build status to authors`.

---

## Phase 6 — Packaging and deployment

### Task 19: WASM-OJ runtime layer in the worker image

**Files:** `infra/docker/worker.Dockerfile`

**New stages:**

```dockerfile
FROM rust:1.97.1-bookworm@sha256:14bc9c5966e7b3a385794b3d5389a8765668342025fbcc7b2e3d2866ac4bd8c3 AS wasm-oj-runtime
WORKDIR /src
ADD --keep-git-dir=false https://github.com/wasm-oj/forge.git#v0.2.3 /src
RUN cargo build --locked --manifest-path crates/runtime-core/Cargo.toml --release --bin wasm-oj-runner --bin wasm-oj-compiler \
  && mkdir -p /opt/wasm-oj/bin \
  && install -m 0755 -s crates/runtime-core/target/release/wasm-oj-runner crates/runtime-core/target/release/wasm-oj-compiler /opt/wasm-oj/bin/ \
  && find /opt/wasm-oj -exec touch -h -d @0 {} +

FROM node:24-bookworm-slim@<same digest as the builder> AS wasm-oj-toolchains
RUN mkdir -p /opt/wasm-oj/toolchains && cd /opt/wasm-oj/toolchains \
  && npm init -y >/dev/null && npm install --ignore-scripts --no-audit --no-fund @wasm-oj/toolchain-clang@0.2.0 @wasm-oj/toolchain-python@0.2.0 \
  && rm package-lock.json && find /opt/wasm-oj -exec touch -h -d @0 {} +
```

**Runtime stage:** put these first, before any app `COPY`, so they form layers that stay byte-identical across releases:

```dockerfile
COPY --link --from=wasm-oj-runtime /opt/wasm-oj/bin /opt/wasm-oj/bin
COPY --link --from=wasm-oj-toolchains /opt/wasm-oj/toolchains /opt/wasm-oj/toolchains
```

**Verify:**

- `docker buildx build -f infra/docker/worker.Dockerfile --target <runtime stage> .` twice.
- `docker image inspect --format '{{json .RootFS.Layers}}'` shows identical digests for the two wasm-oj layers.
- Record the layer sizes in the PR description.
- If `install -s` breaks the binaries (run `/opt/wasm-oj/bin/wasm-oj-runner --help`), drop `-s`.

**Test:** `tests/unit/infra/wasm-oj-pins.test.ts` (Task 3) now also asserts:

- the forge tag `v0.2.3` in the Dockerfile matches the `@wasm-oj/server` pin;
- the toolchain versions match.

**Commit:** `build(worker): bundle the pinned WASM-OJ runtime and server toolchains`.

### Task 20: `worker-test` Deployment

**Files:**

- Create `infra/charts/nojv/templates/worker-test.deployment.yaml` from `worker-platform.deployment.yaml`:
  - `{{- if .Values.worker.test.enabled }}`
  - name `nojv-worker-test`, label `nojv-role: worker`
  - env `WORKER_MODE=test`
  - `WASM_OJ_RUNTIME_DIR=/opt/wasm-oj/bin`, `WASM_OJ_TOOLCHAIN_DIR=/opt/wasm-oj/toolchains`, `WASM_OJ_CACHE_DIR=/var/cache/wasm-oj`
  - `TEST_JUDGE_SLOTS={{ .Values.worker.test.slots }}`
  - an emptyDir at `/var/cache/wasm-oj` (`sizeLimit: 2Gi`)
  - `automountServiceAccountToken: false`
  - resources from `worker.test.resources`
  - Keep the env that `workerEnvSchema` requires; see the comment at `worker-platform.deployment.yaml:1-6`.
- `values.yaml`: `worker.test: { enabled: false, replicas: 1, slots: 2, resources: { requests: { cpu: 500m, memory: 512Mi }, limits: { cpu: "2", memory: 2Gi } } }`.
- `values-single-machine.yaml`: `worker.test.enabled: true`.
- Web Deployment env: `TEST_JUDGE_ENABLED: {{ .Values.worker.test.enabled | quote }}`. Add it to the web env schema with `.default("false")`.
- `pdb.yaml:2` list, `app-network-policy.yaml:15-17` (if the worker selector does not already cover it), `worker-rbac.yaml` (a ServiceAccount with no Role), chart `README.md:36-45`.
- Tests:
  - `tests/unit/infra/env-manifest-parity.test.ts`: render with `worker.test.enabled=true`; `nojv-worker-test` satisfies `workerEnvSchema` with `WORKER_MODE=test`; web has `TEST_JUDGE_ENABLED`.
  - `tests/unit/infra/workload-disruption.test.ts:42-84`.
- Run `pnpm lint:helm`.

**Commit:** `feat(chart): worker-test deployment for the test-judge queue`.

---

## Phase 7 — Seeds, docs, decisions

### Task 21: Seed fixes

**Files:** `packages/db/prisma/seeds/problems.ts`

- `problem_any-two-sum` (:548): the checker treats `judge_answer.strip() in ("NO", "-1")` as "no pair". Hidden answers stay `YES`/`NO`.
- `problem_guess-the-number` (:619):
  - Change sample 1's transcript to the interactor's real `1 1000000` dialogue for secret 42.
  - Set `interactorInput: "42"` and `"500000"`.
  - Set `interactionFormat`: the interactor reads one integer `secret` and replies higher/lower/correct, with 20 guesses.
- `problem_multi-interactive-bisect` (:982), `problem_noisy-oracle-hunt` (:1104), `problem_interactive-peak` (:4441):
  - Set `interactorInput` to the secret the sample transcript was written for. Fix any transcript that no testcase or secret can produce (bisect's explanation uses 375000).
  - Set `interactionFormat`.
- Check whether `packages/db/prisma/prod-seed.ts` / the Helm seed hook updates existing problems.
  - If it does not, add a data migration `20261006120100_seed_interactive_samples` that updates `Problem.samples` and `ProblemStatement.interactionFormat` for those five ids (prod rows exist; see memory "prod seed + Helm seed hook").

**Tests:**

- `pnpm db:seed` on a fresh dev DB (`pnpm --filter @nojv/db exec prisma migrate reset --force && pnpm db:seed`).
- With the local runtime, run the any-two-sum checker on both samples (`answer = output = sample.output`) and expect 42. Add it to the gated integration test from Task 9.

**Commit:** `fix(seed): samples the test judge can run`.

### Task 22: Living docs and decisions

- `docs/decisions/judge.md` JDG-15:
  - Rewrite the body: browser Test runs the contestant; checker and interactive judging runs server-side in WASM on `test-judge`; judge programs never reach clients.
  - Add `Rejected:` lines for:
    - shipping judge source or compiled WASM to browsers;
    - a per-problem exposure toggle;
    - separate public Test judge programs;
    - full server-side Test through stage Jobs.
  - Update `Code:` and `Source:` (this PR).
- JDG-05: add a sentence that Test never sends judge programs, non-sample answers or hidden input to clients.
- JDG-12: the queue list.
- PRB-03: `interactorInput` and `interactionFormat`.
- `docs/decisions/README.md` index lines.
- `docs/architecture/JUDGE_PIPELINE.md` "Browser Test":
  - Replace the "Private checkers/interactors … public assets" bullet.
  - Add the test-judge flow, limits and error codes.
- `docs/architecture/ARCHITECTURE.md`: queues, worker modes, the `test` worker.
- `REDIS.md` (Task 14), `DATABASE.md` (Tasks 5–6).
- `docs/operations/DEPLOYMENT.md`: `worker-test`, the image layer, and the forge upgrade procedure (bump the tag and versions, rebuild the image, run the pin test).
- `docs/operations/THREAT_MODEL.md` and `SECURITY.md`: untrusted contestant WASM runs in `worker-test`, bounded by instruction, memory and wall limits, with no service-account token.
- `docs/runbooks/getting-started.md`: optional local test judge (build forge binaries, install the toolchains, the three env vars).
- `docs/features/`: the problem/editor feature spec Given/When/Then for checker and interactive Test (find the editor or problems file).
- Run `pnpm format:write`, `pnpm lint:repo`.

**Commit:** `docs: checker and interactive Test via the test judge`.

---

## Phase 8 — Verification and PR

### Task 23: Full verification

1. Run `pnpm ci:verify` (format, `lint:repo`, build, typecheck, lint, `typecheck:tests`, unit, component).
2. Run the integration suite for the touched files, with and without `WASM_OJ_RUNTIME_DIR` set (the gated tests skip cleanly when it is unset).
3. Check end to end in the browser, using the `verify` skill recipe:
   - Start `pnpm dev`, plus a local worker with `WORKER_MODE=all` and the three WASM-OJ env vars.
   - Seed, then open `problem_any-two-sum` and press Test: both samples are AC; a wrong pair is WA with the team message.
   - Open `problem_guess-the-number` (Python interactor): the Test button is disabled with the "not supported yet" text.
   - Change its interactor to a C++ copy in a scratch problem: Test → AC with the transcript.
   - A special_env problem shows the disabled text.
   - Take screenshots for the PR.
4. Run `pnpm lint:helm` and `docker buildx build` of the worker image (Task 19 checks).
5. Run a load sanity check: 20 parallel `POST /test-judge` calls for a cpp checker against the local worker with `TEST_JUDGE_SLOTS=2`. The extra calls either wait or get 503 `test_judge_busy`, and nothing hangs past 30 s.

### Task 24: Clean up and open the PR

1. Delete `docs/superpowers/specs/2026-10-06-checker-interactive-test-design.md` and this plan (AGENTS.md rule 3).
2. Commit: `docs: remove shipped checker/interactive Test spec and plan`.
3. Push `feat/checker-interactive-test` and open the PR. The body lists:
   - the forge follow-up (Python interactors after the upstream release);
   - the measured image layer sizes;
   - the Python checker latency;
   - screenshots.
     End it with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
4. Bind the PR with `ccd_pr`, check CI, and fix failures. Merge on green per the owner's standing rule, then follow the main CI and deploy, and run the exam-style Test load test before any exam uses checker or interactive problems.
