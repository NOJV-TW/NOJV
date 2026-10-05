# Browser Test for checker and interactive problems

**Status:** Design approved by the owner, not implemented · **Date:** 2026-10-06 · **Touches:** JDG-03, JDG-05, JDG-15, PRB-03, SEC-12, DAT-06

## Problem

Browser **Test** (JDG-15) only supports `judgeType: "standard"`. On checker and interactive problems the Test button is still enabled; clicking it throws `client_test_private_judge`, whose message asks students to request a "public Test judge program" from the author. No such authoring feature exists, so students cannot act on it.

Production on 2026-10-04 had 6 checker and 4 interactive problems, all public seed problems with **Python** judge programs, none used in a course activity (10 submissions in 14 days).

The server also recompiles the checker or interactor on every judge stage (`apps/sandbox-runner/src/judges/judge-stage.ts`, `apps/sandbox-runner/src/index.ts`).

## Goals

- Test works on checker and interactive problems with no per-problem setup by the author.
- Checker and interactor programs never reach the browser (JDG-05 keeps holding).
- Compile-heavy work stays on the client; the server only runs the judge program.
- Judge programs are compiled once and cached, for Test and for official judging.

## Non-goals

- No change to official Submit semantics, verdicts or the Kubernetes judge pipeline beyond the precompile in Part B.
- `special_env` (Advanced) Test stays unsupported.
- JS/TS contestants on interactive problems stay unsupported until upstream streams QuickJS stdin.
- No admin or author toggle for what is public.

## Decisions and rejected alternatives

The owner chose **"contestant runs in the browser, judge program runs on the server"**. Rejected:

- **Ship the checker or interactor source to the browser.** Anything executed client-side is readable in DevTools. Concrete failure modes:
  - A checker for multiple-answer problems often computes the optimum itself, which leaks the reference algorithm.
  - Readable source makes checker holes easy to find, and the server uses the same checker, so official verdicts can be gamed.
  - An interactor that derives its secret from a PRNG or the case number becomes predictable.
  - Staff-only `judgemessage` strings and hidden-case special cases are exposed.
  - Problems are reused across semesters and forks, so a leak is permanent.
  - Page lock does not block DevTools during exams.
- **A per-problem "allow browser Test (publishes source)" toggle.** The owner does not want authors deciding exposure.
- **Separate public Test judge programs.** These double the authoring work, and problems without one stay untestable.
- **Compile the judge program to WASM and ship the binary.** This raises the bar but is not a boundary: strings survive, the module can be probed as a black-box oracle, and Python judge programs would still ship as source or `.pyc`.
- **Full server-side Test through the Kubernetes pipeline.** Each click would cost a stage Job (about 7 s of slot time). The 2026-10-05 exam stress test showed judging is already CPU-bound at about 20 submissions per minute.

## Design

### 1. Flow

**Checker problems**

1. The browser compiles and runs the contestant program exactly as standard Test does today. TLE, MLE and RE are decided client-side.
2. For each case that exited normally, it posts the contestant stdout to `POST /api/problems/{id}/test-judge`, together with the sample index or the custom `input` + `expectedOutput`.
3. The server runs the checker under the DOMjudge protocol (JDG-03): contestant output on stdin, args `input answer feedback_dir`, exit 42 is AC and 43 is WA. It returns the verdict and `teammessage.txt`.

**Interactive problems**

1. The browser compiles the contestant to a WASM artifact.
2. It posts the artifact plus each case's interactor input (a sample's `interactorInput`, or the custom case `input`).
3. The server runs `interactTrusted(contestant, interactor)` from `@wasm-oj/server`.
4. Verdicts merge as on the server (`apps/worker/src/sandbox/shared/check-interactive.ts`): an interactor failure is SE; otherwise contestant TLE/MLE/RE wins; otherwise the interactor's AC/WA stands.
5. The transcript (`contestantToInteractor` / `interactorToContestant`) is returned for display.

Splitting an interactive run across the network (contestant in the browser, interactor on the server) is rejected: every turn would be a round trip and the server would hold state.

### 2. Server execution

- **Request.** The request carries `context` (practice, assignment or exam) and reuses the submission access rules: `assertProblemViewAccess`, the active exam session and the proctoring gate (`checkProctoringGateInTx`). At most 15 cases per request (5 samples + 10 custom).
- **Artifact size.** The interactive artifact is capped at about 16 MiB. For runtime-bundle languages (Python) the client should send only the script plus the runtime identity, and the server resolves the runtime from its own verified toolchain cache. This depends on upstream work (§7); verify it before implementing.
- **Queue and worker.** Web dispatches a workflow on a new Temporal task queue `test-judge` and awaits the result with a ~15 s deadline.
  - A new `WORKER_MODE=test` Deployment (same worker image) polls it with a small fixed slot count (2–4), its own CPU limit and no access to the `judge` queue. Official judging never competes with Test.
  - Add the queue as a single partition in the three Temporal dynamic configs (docker, flux, gke), as was done for `judge-cleanup`.
- **Limits.**
  - The contestant gets the problem time and memory limits, with time on the language-factored logical-time budget (JDG-15) plus a 10 s wall-clock safety stop.
  - The interactor gets the server's validator timeout policy.
  - Output is capped at 16 MiB as in standard Test.
  - Uploaded artifacts pass upstream static admission before they run.
- **Rate limiting.** A per-user `rl:test-judge` allows 30 requests per minute. Test is exempt from the submit cooldown (PRB-22).
  - When no slot frees up before the deadline, the response is "Test is busy, try again shortly"; requests never queue indefinitely.
- **Response.** Per case: the verdict and `teammessage`, plus contestant stderr and the transcript (capped at 64 KiB) for interactive problems.
  - Never returned: `judgemessage` (JDG-03), interactor stderr, hidden testcases, and the judge program in any form.

### 3. Judge program WASM build and cache

- The worker compiles the checker or interactor with `@wasm-oj/server`'s `ServerCompiler` into a `TrustedJudgeProgram`.
- Results are stored in object storage, content-addressed by `sha256(source, language, toolchain identity)`. No DB column is needed.
- Saving a problem enqueues a durable-work build. A cache miss at Test time builds on demand.
- A `@wasm-oj` upgrade changes the toolchain identity, so programs rebuild on next use with no author action.
- The browser clang toolchain differs from server g++: no exceptions, no RTTI (`-fno-rtti`), no threads, `fork` or signals under WASI. Most judge programs are unaffected.
  - A build failure **does not block saving**. The editor shows "this judge program cannot run in Test: \<reason\>", and Test is disabled for that problem. Official judging is unaffected.
- Python judge programs get the same DOMjudge wrapper the sandbox runner prepends (`apps/sandbox-runner/assets/wrappers/python-validator.py`, `python-interactor-domjudge.py`) once upstream supports Python trusted programs.

### 4. Data model and authoring

- **`problemSampleSchema`** gains an optional `interactorInput` (≤ 200 000 chars), like #638's `explanation`. It lives in `Problem.samples` JSON, so no migration is needed.
  - It is **required on save for every sample of an interactive problem**.
  - The problem page shows it in the sample block, next to the existing transcript-style `input`/`output`.
- **`ProblemStatement.interactionFormat`** (Markdown, default `""`, migration required) is shown and edited only for interactive problems. It describes the interactor input format and the interactor's behaviour, and is also shown beside the custom-case input in the Test panel.
  - `forkProblemInTransaction`, bundle export/import and the statement editor carry it.
- **Checker sample self-check.** On save the server runs the checker on each sample with `answer = output` and `contestant output = output`, and expects AC.
  - A failure warns the author: "this sample output cannot serve as the checker answer". That sample is excluded from Test.
  - Test uses `sample.output` as the answer file. No new field.
- **Custom cases** keep `runCaseSchema`.
  - Checker problems: with `expectedOutput` the checker runs with it as the answer; without it the case is execution-only (JDG-15 rule).
  - Interactive problems: `input` is the interactor input. The panel relabels it, hides "expected output" and shows `interactionFormat`.
- **Seed data.**
  - Fill `interactorInput` and `interactionFormat` for the 4 interactive seed problems.
  - Make the two-sum checker's answer file match its sample output.

### 5. Test button states

The problem page load returns a server-computed Test capability, so the button is correct before the first click:

| Case                                                              | Button   | Text                                                    |
| ----------------------------------------------------------------- | -------- | ------------------------------------------------------- |
| standard, checker or interactive with a built judge program       | enabled  | —                                                       |
| `special_env`                                                     | disabled | This problem type does not support Test; submit instead |
| judge program build failed or language not yet supported upstream | disabled | This judge program cannot run in Test; submit instead   |
| interactive and the contestant language is JS/TS                  | disabled | Interactive Test does not support this language yet     |

`client_test_private_judge` and its message are removed.

### 6. Part B: precompile judge programs for official judging (owner request)

Today every judge stage compiles the checker or interactor again (`compileValidator` / `compileInteractor`, `g++ -O2 -std=c++20`, or the Python wrapper).

Compile each native judge program once per `(source sha256, language, sandbox image digest)`, store the build output content-addressed like testcases (JDG-23), and have stages use the cached binary, compiling only on a miss.

Open points for the plan:

- **Where the build runs.** A compile-only stage Job at save time, or the first stage uploading its build.
- **How the binary reaches the judge container.** ConfigMaps cap at 1 MiB, so it probably goes through the testcase cache path.

Current production judge programs are all Python (no compile), so measure the C++ per-stage compile cost before sizing this. Part B is independent of Parts 1–5 and can ship separately.

### 7. Upstream `wasm-oj/forge` work

Develop in the owner's fork (`~/code/forge`), contribute upstream, then bump NOJV's pinned `@wasm-oj/*` (JDG-15 rule: generic runtime fixes land upstream).

1. **Python trusted judge programs.** Today `TrustedJudgeRuntimeProfile` is `c | cpp | rust | go` wasip1 only. Add CPython so `runTrusted` / `interactTrusted` run Python checkers and interactors.
2. **Runtime-bundle contestants by reference for `interactTrusted`.** The client should be able to send script + runtime digest instead of the whole CPython bundle.
3. **Later, not required.** The browser runner rejects non-standalone interactors (`src/runtime/runner.worker.ts:415`, present since the v1 baseline); it is irrelevant here because interactors run server-side. QuickJS streaming stdin would enable JS/TS interactive contestants.

## Rollout

1. Upstream item 1 first. It is on the critical path, because every existing checker and interactive problem uses Python.
2. Develop Parts 1–5 in NOJV in parallel against the fork, then bump `@wasm-oj/*` to the upstream release.
3. Ship Parts 1–5 in one NOJV release: button states, `interactorInput`, `interactionFormat`, C++ and Python judge programs, and checker/interactive Test. Part B ships on its own.
4. Before Test is used in an exam, run a load test with the virtual-student harness (`memory/stress-scripts/exam-real/`): 65 students pressing Test on checker and interactive problems. Check the `test-judge` worker CPU, queue rejections and web latency.

## Testing

- **Unit:** verdict mapping (42/43/other → AC/WA/SE; interactive merge), capability computation, sample schema (`interactorInput` required for interactive), checker sample self-check, rate limiter.
- **Integration:** a real `@wasm-oj/server` running C++ and Python checkers and interactors; access control for practice, assignment and exam (proctoring gate); 15-case and artifact-size limits; busy response when slots are exhausted.
- **Component:** Test button states and texts; the interactive panel (relabelled input, hidden expected output, `interactionFormat`, transcript).
- **E2E:** Test on the checker and interactive seed problems.

## Docs and decisions to update in the shipping PR

- **JDG-15:** checker and interactive Test now run the contestant in the browser and the judge program server-side in WASM on a dedicated queue. Record the rejected alternatives above as `Rejected:` lines.
- **JDG-05:** still holds. Note that Test never sends judge programs, answers beyond public samples, or hidden input to clients.
- **PRB-03:** samples gain `interactorInput`, and interactive statements gain `interactionFormat`.
- **`docs/architecture/JUDGE_PIPELINE.md`** "Browser Test": replace "Private checkers/interactors … need browser-compatible public assets" with this design. Document the `test-judge` queue and worker mode.
- **`docs/architecture/DATABASE.md`:** `ProblemStatement.interactionFormat`.
- **Feature specs under `docs/features/`:** interactive sample and Test behaviour.

## Risks and open questions

- **Image size.** The worker image grows by `@wasm-oj/server`, `@wasmer/sdk` and the clang toolchain. Production pulls images over a ~0.5 MB/s uplink (OPS-20). Measure, and fetch toolchain assets lazily into a cache if the growth is large.
- **In-process WASM sandbox.** Interactive Test runs untrusted contestant WASM inside the `test` worker. It relies on upstream admission, instruction budgets and memory limits. Isolate it in its own Deployment (above) and include it in the threat model.
- **Fidelity.** Test results stay previews (JDG-15). Logical time, WASI and clang flags differ from native judging, so a Test AC does not imply a Submit AC.
- **Payload size for runtime-bundle contestants** depends on upstream item 2.
