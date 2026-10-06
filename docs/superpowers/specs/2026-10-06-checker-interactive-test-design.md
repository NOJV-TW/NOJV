# Browser Test for checker and interactive problems

**Status:** Design approved by the owner, revised after the 2026-10-06 spike, in implementation · **Date:** 2026-10-06 · **Touches:** JDG-03, JDG-05, JDG-15, PRB-03, SEC-12, DAT-06

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
- **Judge client-supplied custom cases with the private checker or interactor.** This turns the judge program into an oracle: a student could post arbitrary input/answer pairs or interactor inputs and read back verdicts and `teammessage` to map the checker's acceptance rule or the interactor's behaviour, then exploit it in official judging. Mitigation: Test judges samples only, by sample index, and the server reads the input, answer and interactor input from `Problem.samples` itself, never from the request. Custom cases are execution-only on checker problems and unavailable on interactive problems.

## Design

### 1. Flow

**Checker problems**

1. The browser compiles and runs the contestant program exactly as standard Test does today. TLE, MLE and RE are decided client-side.
2. For each sample that exited normally, it posts the contestant stdout with the sample index to `POST /api/problems/{id}/test-judge`. The server reads that sample's `input` and `output` (the answer) from `Problem.samples`; the request never carries them.
3. Custom cases are execution-only: the browser shows their run status and output and never sends them to the checker.
4. The server runs the checker under the DOMjudge protocol (JDG-03): contestant output on stdin, args `input answer feedback_dir`, exit 42 is AC and 43 is WA. It returns the verdict and `teammessage.txt`.

**Interactive problems**

1. The browser compiles the contestant to a WASM artifact.
2. It posts the artifact plus the indices of the samples to run. The server reads each sample's `interactorInput` from `Problem.samples`; a sample without one is rejected, so the client skips it.
3. Custom cases are unavailable on interactive problems.
4. The server runs `interactTrusted(contestant, interactor)` from `@wasm-oj/server`.
5. Verdicts merge as on the server (`apps/worker/src/sandbox/shared/check-interactive.ts`): an interactor failure is SE; otherwise contestant TLE/MLE/RE wins; otherwise the interactor's AC/WA stands.
6. The transcript (`contestantToInteractor` / `interactorToContestant`) is returned for display.

Splitting an interactive run across the network (contestant in the browser, interactor on the server) is rejected: every turn would be a round trip and the server would hold state.

### 2. Server execution

- **Request.** The request carries `context` and is authorised by `assertProblemContextAllowed` in `code-draft.ts`, the read-only check shared with drafts: page lock, exam session + proctoring gate, assignment membership, contest window and participation (managers exempt), the virtual-contest timer, practice view access. It is looser than Submit (no assignment close or language check), which is acceptable because Test never creates a submission. Cases are sample indices, each at most once, so a request holds at most 5.
- **Artifact size.** The interactive artifact is capped at 16 MiB. A C++ contestant compiles to about 0.6 MB of Wasm. Runtime-bundle languages (Python) already reference their runtime by digest (`runtimePackage`), so the upload is only the script and manifest; the server resolves the runtime from its own pinned toolchain.
- **Queue and worker.** Web executes a workflow on a new Temporal task queue `test-judge` and awaits its result with a 30 s deadline (a Python checker costs about 1.1 s per case). This is the first workflow whose result web awaits.
  - A new `WORKER_MODE=test` Deployment (same worker image) polls it with a small fixed slot count (2–4), its own CPU limit and no access to the `judge` queue. Official judging never competes with Test. `ServerRunner` accepts one operation at a time, so the worker keeps one engine per slot.
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

- The worker compiles the checker or interactor with `@wasm-oj/server` into an ordinary build artifact and runs it with `Engine.run` / `Engine.interact`, not the `runTrusted` path (whose profiles exclude Python).
- Results are stored in object storage, content-addressed by `sha256(source, language, toolchain identity)`. No DB column is needed.
- Saving the judge configuration starts a best-effort build workflow on `test-judge` after commit. A cache miss at Test time builds on demand, so a lost background build is harmless. The cached build record (success or diagnostics) also feeds the Test capability and the editor's build status.
- A `@wasm-oj` upgrade changes the toolchain identity, so programs rebuild on next use with no author action.
- The browser clang toolchain differs from server g++: no exceptions, no RTTI (`-fno-rtti`), no threads, `fork` or signals under WASI. Most judge programs are unaffected.
  - A build failure **does not block saving**. The editor shows "this judge program cannot run in Test: \<reason\>", and Test is disabled for that problem. Official judging is unaffected.
- Python judge programs get the same DOMjudge wrapper the sandbox runner prepends (`apps/sandbox-runner/assets/wrappers/python-validator.py`, `python-interactor-domjudge.py`). Python checkers work on `@wasm-oj/server` 0.2.3 (spike: about 1.1 s per case). Python interactors need the upstream change in §7 and stay disabled until NOJV pins that release.
- C++ builds get NOJV's `src/bits/stdc++.h` shim and PCH header, shared with browser Test.
- **Packaging.** The worker image gains a stable layer with the `wasm-oj-compiler` / `wasm-oj-runner` binaries (built from forge `crates/runtime-core` at the pinned version, about 75 MB unstripped) and the server toolchains (`@wasm-oj/toolchain-clang` 54 MB, `toolchain-python` 5 MB), installed outside the app's `node_modules` so ordinary releases do not re-pull them. `WASM_OJ_RUNTIME_DIR` unset disables Test judging (local dev without the binaries).

### 4. Data model and authoring

- **`problemSampleSchema`** gains an optional `interactorInput` (≤ 200 000 chars), like #638's `explanation`. It lives in `Problem.samples` JSON, so no migration is needed.
  - It is **required when samples are saved on an interactive problem**. Switching an existing problem to interactive does not block; samples without it are excluded from Test and the editor warns.
  - The problem page shows it in the sample block, next to the existing transcript-style `input`/`output`.
- **`ProblemStatement.interactionFormat`** (Markdown, default `""`, migration required) is shown and edited only for interactive problems. It describes the interactor input format and the interactor's behaviour.
  - `forkProblemInTransaction` and the statement editor carry it. Problem bundles carry neither samples nor statements, so they are unchanged.
- **Checker sample self-check.** On save the server runs the checker on each sample with `answer = output` and `contestant output = output`, and expects AC.
  - A failure warns the author: "this sample output cannot serve as the checker answer". That sample is excluded from Test.
  - Test uses `sample.output` as the answer file. No new field.
- **Custom cases** keep `runCaseSchema` and never reach the judge program (see the oracle entry under rejected alternatives).
  - Checker problems: custom cases are execution-only (JDG-15 rule), with or without `expectedOutput`.
  - Interactive problems: custom cases are unavailable; Test runs the samples that have an `interactorInput`.
- **Seed data.**
  - Fill `interactorInput` and `interactionFormat` for the 4 interactive seed problems.
  - `problem_any-two-sum`: its hidden answers are `YES`/`NO` while its sample outputs are a pair or `-1`. Make the checker accept both answer forms instead of changing hidden data.
  - `problem_guess-the-number`: sample 1 shows range `1 100`, but the interactor always writes `1 1000000`. Fix the transcript.

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

1. **Accept runtime-bundle interactors.** `Runner.interact` rejected any interactor that was not a standalone Wasm module (`src/server/server-runner.ts:307`, `src/runtime/runner.worker.ts:415`), although both sides share the same preparation. Removing the guard runs a CPython interactor end to end. Done on branch `feat/runtime-bundle-interactor` with a server integration test, pending an upstream PR.
2. Not needed: Python checkers already run through `Engine.run`, and runtime-bundle artifacts already reference their runtime by digest.
3. **Later, not required.** QuickJS streaming stdin would enable JS/TS interactive contestants.

## Rollout

1. Ship Parts 1–5 against `@wasm-oj/*` 0.2.3: checker Test for C++ and Python, interactive Test for C++ interactors, Python interactors shown as not yet supported.
2. Send upstream item 1; when its release lands, bump the pins and enable Python interactors in a small follow-up.
3. Part B ships on its own.
4. Before Test is used in an exam, run a load test with the virtual-student harness (`memory/stress-scripts/exam-real/`): 65 students pressing Test on checker and interactive problems. Check the `test-judge` worker CPU, queue rejections and web latency.

## Testing

- **Unit:** verdict mapping (42/43/other → AC/WA/SE; interactive merge), capability computation, sample schema (`interactorInput` required for interactive), checker sample self-check, rate limiter.
- **Integration:** a real `@wasm-oj/server` running C++ and Python checkers and interactors; access control for practice, assignment, contest, virtual contest and exam (proctoring gate); stored requests built from server-side sample data whatever the client sends; sample-index and artifact-size limits; busy response when slots are exhausted.
- **Component:** Test button states and texts; custom cases execution-only on checker problems and hidden on interactive problems; the interactive transcript.
- **E2E:** Test on the checker and interactive seed problems.

## Docs and decisions to update in the shipping PR

- **JDG-15:** checker and interactive Test now run the contestant in the browser and the judge program server-side in WASM on a dedicated queue. Record the rejected alternatives above as `Rejected:` lines.
- **JDG-05:** still holds. Note that Test never sends judge programs, answers beyond public samples, or hidden input to clients.
- **PRB-03:** samples gain `interactorInput`, and interactive statements gain `interactionFormat`.
- **`docs/architecture/JUDGE_PIPELINE.md`** "Browser Test": replace "Private checkers/interactors … need browser-compatible public assets" with this design. Document the `test-judge` queue and worker mode.
- **`docs/architecture/DATABASE.md`:** `ProblemStatement.interactionFormat`.
- **Feature specs under `docs/features/`:** interactive sample and Test behaviour.

## Risks and open questions

- **Image size.** The worker image grows by about 130–170 MB. Production pulls images over a ~0.5 MB/s uplink (OPS-20), so that layer must stay byte-identical across releases (built from a pinned forge version, normalised timestamps) and only change on a forge upgrade.
- **In-process WASM sandbox.** Interactive Test runs untrusted contestant WASM inside the `test` worker. It relies on upstream admission, instruction budgets and memory limits. Isolate it in its own Deployment (above) and include it in the threat model.
- **Interactive time limits.** Upstream `interact` (0.2.3) does not stop a CPU-bound contestant on its logical-time or instruction budget the way `run` does; only the shared wall stop ends it. Test therefore gives each interactive case a wall stop of max(3 s, 3 × the language-factored limit) and reports a full-length wall stop as TLE. To be raised upstream.
- **Fidelity.** Test results stay previews (JDG-15). Logical time, WASI and clang flags differ from native judging, so a Test AC does not imply a Submit AC.
- **Python checker latency.** About 1.1 s per case on the spike machine, so 5 samples take about 6 s of the 30 s deadline. Measure on production hardware.
