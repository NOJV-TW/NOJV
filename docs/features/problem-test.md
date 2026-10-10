# Feature: Problem Test

Acceptance spec for the solving workspace's **Test** button: running the student's code on samples and their own cases without creating a submission. Everything runs in the student's browser, including the problem's checker or interactor, whose source the browser fetches when the editor opens. Also covers the author side of interactive problems: interactor inputs and interaction notes. Mechanics and limits are in [Judge Pipeline](../architecture/JUDGE_PIPELINE.md#browser-test). Decisions: JDG-15, PRB-03.

## Key code

- `apps/web/src/lib/components/features/problem/editors/use-editor-run.svelte.ts` — Test flow per judge type, error messages
- `apps/web/src/lib/components/features/problem/editors/Editor.svelte`, `EditorActionBar.svelte`, `EditorBottomPanel.svelte` — preparation and button state, case panel, results and transcript
- `apps/web/src/lib/services/browser-local-run.ts` — engine queue, compile, runs, `runBrowserChecker`, `runBrowserInteraction`
- `apps/web/src/lib/services/judge-program.ts` — `prepareJudgeProgram`
- `apps/web/src/routes/api/problems/[id]/judge-program/+server.ts`, `packages/application/src/problem/judge-program.ts` — `getJudgeProgramSource`
- `packages/core/src/judge/test-judge-program.ts`, `test-judge-verdict.ts`, `python-judge-wrappers.ts`, `test-capability.ts`
- Authoring and display: `apps/web/src/lib/components/features/problem/statement/SamplesEditor.svelte`, `tabs/BasicInfoTab.svelte`, `left-panel/ProblemDescriptionPanel.svelte`
- Tests: `tests/unit/web/editor-client-test.test.ts`, `browser-local-execution.test.ts`, `browser-engine-queue.test.ts`, `judge-program.test.ts`, `tests/unit/core/test-judge-verdict.test.ts`; `tests/component/web/editor-test-button-state.test.ts`, `editor-judge-program.test.ts`, `editor-output-comparison.test.ts`, `samples-editor.test.ts`; `tests/integration/application/judge-program-source.test.ts`, `tests/integration/http/judge-program.test.ts`

Out of scope: Test for `special_env` problems, official verdicts from Test, Test results in submission history, hiding judge programs from students, JavaScript and TypeScript contestants on interactive problems (pending upstream WASM-OJ).

## API

| Endpoint                                              | Purpose                                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/problems/[id]/judge-program?context=<json>` | The problem's checker or interactor as `{ role, language, source, sha256 }`; 404 for standard and `special_env` problems |

The endpoint requires a session and the problem page's view access for the context; it uses the standard API rate limit.

## Acceptance criteria

### Common

- Given any problem, when the student presses Test, no submission is created, no attempt is consumed, the submit cooldown does not apply, and Test sends neither the code nor its output to the server.
- Given a `special_env` problem, Test is disabled with "This problem type doesn't support Test. Use Submit to have your code judged."
- Given a case that exits normally with nothing to compare against, it shows "Executed" ("This case ran without being judged. Check its output yourself.") instead of AC; a case that hits TLE, MLE or RE shows that verdict on every judge type.
- Given any Test result, it is a preview: passing samples does not imply an AC on Submit.

### Standard problems

- Given a standard problem, the case panel starts with each sample's input and expected output; cases with an expected output get AC or WA from the shared comparator, and cases without one show "Executed".

### Judge program preparation

- Given a checker or interactive problem, when the editor opens, the browser fetches the problem's checker or interactor and builds it while the student works; the Test button shows the toolchain download or "Preparing checker..." / "Preparing interactor...".
- Given the judge program is still preparing, when the student presses Test, Test waits for it and then runs.
- Given the same problem is reopened in the page session with an unchanged judge program, it is not rebuilt; given its source changed, it is rebuilt.
- Given the student leaves a problem before its judge program starts building, that build is dropped and does not delay Test on the next problem; reopening the problem builds it then.
- Given the judge program fails to build, Test is disabled with "This problem's checker failed to build." (or "interactor"), and the Test Result panel opens on the compiler output.
- Given the source request is refused (403 or 404), Test is disabled with "Couldn't load this problem's checker." (or "interactor"); given it fails for any other reason (a server or network failure is retried twice first), the message adds "Reload the page to try again."
- Given a student who may view the problem in the context (including after an exam or contest ends, while the problem is still viewable), the source loads; given an active page-locked exam session, only that exam's problems load.

### Checker problems

- Given a checker problem, when the student presses Test, every case runs in the browser, and each case that exited normally and whose input is exactly a sample's input is judged by the problem's checker with that sample's stored output as the answer. Those cases show AC or WA, with the checker's `teammessage` as "Feedback".
- Given the student edits a sample case's input or adds a case, that case is not judged; it shows "Executed" when it exits normally. The case panel says "This problem's checker judges the samples only…".
- Given the checker crashes, runs out of time or memory, or exits with a code other than 42 or 43, the case is SE with "The judge failed on this case. This is a problem on the judge's side, not with your program."

### Interactive problems

- Given an interactive problem, the case panel lists each sample's interactor input and shows the problem's interaction notes; a sample without an interactor input is left out.
- Given the student adds a case, its input is an interactor input (for example the hidden number), and the real interactor judges it like a sample. The case panel says "…Cases you add are judged the same way."
- When the student presses Test, the browser compiles the program and runs it against the interactor once per case. Each case shows its verdict, the student's stderr, and a transcript with "From the interactor" and "From your program", each cut at 64 KiB; the result shows the longest logical time across the cases.
- Given the student's program is stopped by a time or memory limit, the case is TLE or MLE, whatever the interactor does; otherwise, given the interactor fails (an exit code other than 42 or 43, or a limit), the case is SE; otherwise the student's RE wins; otherwise the interactor's AC or WA stands.
- Given JavaScript or TypeScript is selected, Test is disabled with "Test can't run interactive problems in JavaScript or TypeScript yet…"; switching to another language enables it.

### Problem page and authoring

- On an interactive problem the statement shows the "Interaction" notes, and each sample shows its interactor input with a copy button, above the transcript-style input and output.
- The basic info section shows "Interaction notes" (Markdown, up to 8,000 characters) only for interactive problems.
- On an interactive problem each sample has an "Interactor input" field, and its input and output are labelled as the two sides of the transcript. Saving samples on an interactive problem with any sample lacking a non-blank interactor input fails with "Every interactive sample needs an interactor input."
- Students can read the checker or interactor source, and the judge tab of the edit page says so under the checker or interactor language ("Students can read this program when they press Test."); `judgemessage` and the interactor's stderr are not shown in Test.
