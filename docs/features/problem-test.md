# Feature: Problem Test

Acceptance spec for the solving workspace's **Test** button: running the student's code on samples and their own cases without creating a submission. The browser compiles and runs the code; checker and interactive problems are judged by the problem's private checker or interactor on the server, on samples only. Also covers the author side: interactor inputs, interaction notes, the judge-program build status and the sample check. Mechanics and limits are in [Judge Pipeline](../architecture/JUDGE_PIPELINE.md#browser-test). Decisions: JDG-15, JDG-26, SEC-15, PRB-03.

## Key code

- `apps/web/src/lib/components/features/problem/editors/use-editor-run.svelte.ts` — Test flow per judge type, error messages
- `apps/web/src/lib/components/features/problem/editors/Editor.svelte`, `EditorActionBar.svelte`, `EditorBottomPanel.svelte` — button state, case panel, transcript
- `apps/web/src/lib/services/browser-local-run.ts` — browser compile and run; `apps/web/src/lib/services/submission-service.ts` — `requestTestJudge`
- `apps/web/src/routes/api/problems/[id]/test-judge/+server.ts`
- `packages/application/src/test-judge/index.ts` — `runTestJudge`, `checkSamplesWithChecker`, `getJudgeProgramStatus`, `withUserTestJudgeLock`
- `packages/core/src/judge/test-capability.ts`, `packages/core/src/schemas/test-judge.ts`
- Authoring: `apps/web/src/lib/components/features/problem/statement/SamplesEditor.svelte`, `tabs/BasicInfoTab.svelte`, `tabs/judge/JudgeProgramTestStatus.svelte`; edit page actions in `apps/web/src/routes/(app)/problems/[problemId]/edit/+page.server.ts`
- Tests: `tests/unit/web/editor-client-test.test.ts`, `tests/component/web/editor-test-button-state.test.ts`, `editor-output-comparison.test.ts`, `judge-program-test-status.test.ts`, `samples-editor.test.ts`; `tests/integration/application/test-judge-domain.test.ts`, `test-judge-author.test.ts`; `tests/integration/http/test-judge.test.ts`; `tests/integration/judge/test-judge-runtime.test.ts`; `tests/unit/worker/test-judge-activity.test.ts`

Out of scope: Test for `special_env` problems, official verdicts from Test, Test results in submission history, author-chosen exposure of judge programs, Python interactors and JavaScript/TypeScript interactive contestants (pending upstream WASM-OJ).

## API

| Endpoint                             | Purpose                                                                                                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/problems/[id]/test-judge` | Judge samples on the server. Body `{ kind: "checker", context, cases: [{ sampleIndex, output }] }` or `{ kind: "interactive", context, language, artifact, cases: [{ sampleIndex }] }`; returns `{ cases: [...] }` |
| Edit page action `?/checkSamples`    | Run the checker on every saved sample with its `output` as both answer and team output; problem editors only                                                                                                       |

The endpoint requires a session, at most 24 MiB of body, 1 to 5 distinct sample indices, and a `kind` equal to the problem's judge type. Error codes are listed in [Judge Pipeline](../architecture/JUDGE_PIPELINE.md#test-judge).

## Acceptance criteria

### Common

- Test never creates a submission, consumes no attempt and is not subject to the submit cooldown.
- The Test button state is known when the page loads. When Test is unavailable the button is disabled and the reason is shown next to it:
  - `special_env`: "This problem type doesn't support Test. Use Submit to have your code judged."
  - Checker or interactive problem while the test judge is off, or a Python interactor: "Test isn't available for this problem right now. Submit still judges your code normally."
  - Interactive problem with JavaScript or TypeScript selected: "Test can't run interactive problems in JavaScript or TypeScript yet…"; switching language re-enables it.
  - Interactive problem with no sample that has an interactor input: "This problem has no sample with an interactor input…"
- The server answers a request only for a context the user may use: practice view access, assignment membership, an active exam session and the exam gate for that exam, contest participation while the contest runs (managers and admins exempt), or a running virtual contest. Otherwise the request is rejected and nothing is judged.
- If the checker or interactor cannot be built for Test, the request fails with "This problem's checker or interactor can't run in Test. Submit still judges your code normally." and Test stays disabled for the rest of the editor session.
- A second Test from the same user while one is in flight gets "Test is busy right now. Try again in a moment." A 31st request within a minute gets the same message, and so does a request the server could not finish judging within its time budget; no sample is reported as a judge failure for running out of time.
- Results are previews: a server-judged AC does not imply an AC on Submit.

### Standard problems

- Samples and custom cases run in the browser; cases with an expected output get AC/WA from the shared comparator, cases without one show "Executed".

### Checker problems

- Given a checker problem with samples, when the student presses Test, every case runs in the browser and each case whose input is exactly a sample's input and that exited normally is judged by the problem's checker on the server. Those cases show AC or WA with the checker's `teammessage` as "Feedback", and the result is marked "Judged on the server".
- The answer the checker sees is the sample's stored output on the server; editing the expected output in the case panel changes nothing.
- A case whose input is not exactly a sample's input, or that hit TLE, MLE or RE in the browser, is never sent to the checker; a normally exiting one shows "Executed" ("This case ran without being judged. Check its output yourself."). The case panel says "This problem's checker judges the samples only…".
- When the test judge is busy or unavailable, the browser results still show, with samples as "Executed" and the busy or unavailable message as a notice.
- A checker that crashes, times out or exits with a code other than 42 or 43 is SE, shown as "The judge failed on this case. This is a problem on the judge's side, not with your program."

### Interactive problems

- The case panel lists each sample that has an interactor input, read-only, and shows the problem's interaction notes; students cannot add cases.
- When the student presses Test, the browser compiles the program, and the server runs it against the interactor once per listed sample, with that sample's interactor input as the interactor's input file and an empty answer file.
- Each case shows its verdict, the student's stderr, the time, and a transcript with "From the interactor" and "From your program".
- The interactor's failure is SE; otherwise the student's TLE, MLE or RE wins; otherwise the interactor's AC or WA. A student program still running at its wall stop (max(3 s, 3 × the language-factored time limit)) is TLE.

### Problem page

- On an interactive problem the statement shows the "Interaction" notes, and each sample shows its interactor input with a copy button, below the transcript-style input and output.
- Checker and interactor source, `judgemessage`, interactor stderr and build diagnostics never appear on student pages or in Test responses.

### Authoring

- The basic info section shows "Interaction notes" (Markdown, up to 8,000 characters) only for interactive problems.
- On an interactive problem each sample has an "Interactor input" field, and its input and output are labelled as the two sides of the transcript. Saving samples on an interactive problem with any sample lacking a non-blank interactor input fails with "Every interactive sample needs an interactor input."
- Saving a checker or interactor configuration that Test supports starts a background build; saving never fails because of it.
- The judge section shows editors the build status for Test: "Test can run this judge program.", "Preparing this judge program for Test…", or "This judge program can't run in Test. Submissions are still judged normally." with the build output. When the test judge is off it says "Test judging isn't enabled on this server."
- On a checker problem the judge section offers "Check samples with the checker", disabled with "Save your changes first…" while the section has unsaved changes. It lists each sample's verdict, the checker's message for rejected ones, and when any sample is rejected: "The checker must accept each sample's output, because students' Test uses it as the answer…".
