# Browser Test runs checkers and interactors

**Status:** Direction decided by the owner on 2026-10-07, after the final review round that day · **Touches:** JDG-03, JDG-05, JDG-12, JDG-15, JDG-26, OPS-18, OPS-21, PRB-01, PRB-03, PRB-09, PRB-22, SEC-12, SEC-15, WEB-05

## Problem

#641 (merged 2026-10-06, not released) added Test for checker and interactive problems by running the problem's checker or interactor on a server test worker. That worker runs TA-authored judge programs, plus the student's Wasm on interactive problems. The only thing between that code and the container's object-storage keys (every problem's hidden testcases) and Redis URL is the Wasm runtime.

The owner's direction:

- Test is the student's own run, so all of it happens in the student's browser: the judge program is compiled and run there too.
- Judge programs become readable by students. Keeping them robust is the authors' responsibility, and authors test their own problems.
- For Test, the server keeps nothing but a read endpoint for the judge program's source.
- The `hidden` workspace visibility goes away; it never gave confidentiality.
- Checker and interactive problems ship together, with no feature flag and no fallback.

## Goals

- Test on checker and interactive problems shows verdicts (AC/WA/TLE/RE/SE), the checker's `teammessage` and the interaction transcript, all computed in the browser.
- The server executes and compiles nothing for Test. The test worker, its queue, build cache, Test API and the worker image's WASM-OJ layers are removed.
- The judge program is prepared in the background when the editor opens, so pressing Test does not wait on it.
- Hidden testcase data never leaves the server. Test uses only sample data, which the statement already makes public.
- Multi-file problems keep only `editable` and `readonly` files.

## Non-goals

- Official judging is unchanged: Submit, verdicts and the sandbox, and official judging still compiles the judge program from source in its per-stage gVisor Pod.
- No authoring-time check or build status for judge programs; authors press Test on their own problem.
- `special_env` (Advanced) still has no Test.
- No per-problem toggle for what students can read.
- No multi-file precompile. The student's editable files change on every Test, and forge's in-browser object cache already reuses unchanged files.
- A Wasm fast path for official judging is a separate future item (Quality Ledger).

## What becomes public, and the accepted risk

| Data                                   | Test sends it to the browser   |
| -------------------------------------- | ------------------------------ |
| Checker / interactor source            | yes                            |
| Sample input, output, interactor input | yes (already in the statement) |
| `readonly` workspace files             | yes (already today)            |
| Hidden testcases (input or answer)     | **never** (SEC-12)             |

The accepted risk: bugs in a judge program, such as a missing validity check or an off-by-one query limit, become easier to find. Those bugs exist whether or not the source is public, and authors own them. The judge tab states once that students can read the program.

The docs record safe authoring practice:

- A checker only verifies, and reads the optimum from `judge_answer` (the testcase's expected-output field), as the seed checkers do.
- An interactor reads its secret from `judge_input`.

## Design

### Judge program delivery

`GET /api/problems/[id]/judge-program?context=…` returns `{ role, language, source, sha256 }` for checker and interactive problems, and 404 otherwise.

- The source is read through the existing verified script pointer.
- **Authorization:** anyone who may view the problem in that context. Checker Test therefore keeps working after an exam or contest ends, like standard Test.
- The route is classified `exam-scoped` in the exam-confinement allowlist and uses the standard API rate limiter.

### Preparing the judge program in the browser

When the editor opens on a checker or interactive problem, it:

1. fetches the source;
2. builds it with `@wasm-oj/browser`, using core's `judgeProgramCompileInput` (the DOMjudge Python wrapper, or the C++ `bits/stdc++.h` shim with the PCH-only-when-included rule):
   - **Python** is packaged into a runtime bundle at once, with no compile;
   - **C++** compiles in the background;
3. preloads whatever toolchains the judge program needs, next to the student's own: clang for a C++ judge program, the Python runtime for a Python one.

The built program stays in memory for the page session, keyed by `sha256`. It is rebuilt when the editor reopens with different source.

Test waits for it, as it already waits for the student's toolchain, and the button shows that it is preparing. If the judge program fails to build, Test is disabled with a reason and the panel shows the compiler diagnostics. The source is public, so its diagnostics are too.

### Checker problems

1. Compile the student's program and run each selected sample with `stdin = sample.input`, as today.
2. For each sample whose run exited normally, run the checker with:
   - args `/judge/input /judge/answer /judge/feedback`;
   - files: input = `sample.input`, answer = `sample.output`;
   - stdin = the student's stdout;
   - output path `/judge/feedback/teammessage.txt`;
   - official judging's `validatorTimeoutMs` and 512 MiB.
3. Map the result with `checkerCaseVerdict`: exit 42 is AC, 43 is WA, anything else is SE. Show `teammessage`.
4. Custom cases stay execution-only, because they have no `judge_answer` in the author's format.

### Interactive problems

- `engine.interact(contestant, interactor, …)` from `@wasm-oj/browser` runs both programs. The interactor gets `sample.interactorInput` as `/judge/input`.
- Map the result with `interactiveCaseVerdict`, and show the transcript, contestant stderr and time. A contestant stopped by its wall limit is TLE.
- Custom cases take an interactor input, which the student types as the secret, and the real interactor judges them.
- JS/TS contestants stay unavailable until upstream streams QuickJS stdin.

### Upstream dependency

This PR merges only after a `@wasm-oj` release that contains:

| Change                                          | Status           | Why                                                                                                                                                                                                      |
| ----------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser `interact` passes `startupEntropyBytes` | new PR           | `runner.worker.ts` `interactiveCoreProgram` omits the field, but runtime-core requires it (`startup_entropy_bytes: u64`, no serde default), so every browser `interact` fails while decoding its request |
| Python (runtime-bundle) interactors             | wasm-oj/forge#93 | all four interactive problems use Python interactors                                                                                                                                                     |
| In-module interactive metering                  | wasm-oj/forge#95 | a CPU-bound contestant must stop at its instruction budget instead of keeping the student's tab busy until the wall limit                                                                                |

Until that release, NOJV develops against locally built packages. It then pins `@wasm-oj/browser` and the toolchains to the release. Forge must not be patched inside NOJV (JDG-15).

### Removing `hidden` workspace visibility

- On 2026-10-07 production had 9 `editable` files, 9 `readonly` files and **0 `hidden`** files (read-only query).
- A migration sets any `hidden` rows to `readonly`, then recreates the `WorkspaceFileVisibility` enum without `hidden`.
- Stored judge snapshots map a legacy `hidden` to `readonly`, so old submissions still rejudge.
- The UI, application, seeds and tests drop it.
- PRB-01 records the rejection: `hidden` gave no confidentiality, nobody used it, and it misled authors.

### Removed from #641

- The whole server side:
  - the `WORKER_MODE=test` worker and its Deployment;
  - the `test-judge` queue and its partitions;
  - the Test and build workflows, and the build-after-save dispatch;
  - the `test-judge-programs/` cache and the Test API;
  - the Redis lock and the `rl:test-judge` limiter;
  - `TEST_JUDGE_ENABLED`, `WASM_OJ_*` and `TEST_JUDGE_SLOTS`;
  - `@wasm-oj/server` and its EPIPE patch;
  - the worker image's WASM-OJ layers, `infra/docker/wasm-oj-toolchains/` and the related Renovate pins.
- In core: the request, response and record schemas, the cache key and server identity, and `build-artifact-wire`.
- On the edit page: the judge-program build status and the "check samples with the checker" action.

### Kept from #641

- `interactorInput` and `interactionFormat`.
- The seed fixes.
- "Executed" for custom cases without expected output.
- The contest code-draft authorization fix (WEB-05).
- The PCH-only-with-`<bits/stdc++.h>` rule.
- In core: the verdict helpers, Python wrappers, C++ shim and `judgeProgramCompileInput`, now used by the browser.

## Decision log changes

- **JDG-15:** rewritten as "Test runs entirely in the browser, judge programs included".
  - Rejected:
    - running judge programs on the server (#641, withdrawn before release);
    - compiling them on the server (that keeps a server WASM-OJ runtime and worker for a preview feature);
    - execution-only Test;
    - exposure toggles.
  - Rules:
    - what is public, and that authors own their judge programs;
    - the server neither compiles nor executes anything for Test;
    - Test never receives non-sample testcase data.
- **JDG-26, SEC-15 and OPS-21:** withdrawn, each with its reason and a pointer to JDG-15. IDs are never reused.
- **JDG-05:** the "validators never seen" rule is scoped to official judging.
- **JDG-12, PRB-03, PRB-22 and WEB-05:** the server-Test wording goes.
- **PRB-01 and PRB-09:** `hidden` goes; PRB-01 gets a Rejected line.
- **OPS-18:** the wording #641 added goes.

## Testing

- **Unit:**
  - the browser checker and interactor runs with a fake engine (args, files, verdict mapping);
  - judge-program preparation (Python packaging, C++ compile, failure);
  - Test capability per problem type;
  - endpoint authorization (exam, contest window, assignment membership, practice);
  - the visibility migration;
  - legacy-`hidden` snapshot parsing.
- **Component:**
  - Test button states (preparing, build failed, JS/TS on interactive problems);
  - the checker result panel with `teammessage`;
  - the transcript panel;
  - interactive custom cases;
  - the judge-tab note.
- **Browser check on seeds:**
  - `any-two-sum` and `shortest-route-plan`: AC and WA;
  - a C++ checker fixture, and a broken one that disables Test;
  - `guess-the-number` and the other three interactive problems: AC, WA, and TLE from an infinite loop;
  - a multi-file problem showing no `hidden` option;
  - standard problems unchanged.
- `pnpm ci:verify`, `pnpm lint:helm`, and a worker image build without the WASM-OJ layers.
