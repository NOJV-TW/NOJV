# Browser Local Judge Spike Design

**Goal:** Evaluate WASM-OJ browser execution for Standard Mode while letting users run ordinary sample/custom tests locally in the browser.

**Architecture:** Keep NOJV's Temporal, storage, permissions, submission persistence, scoring, rejudge, checker, interactive, and Advanced Mode boundaries. Add the published WASM-OJ browser engine to standard C/C++/Rust/Go/Python/Java/JavaScript/TypeScript local execution. The local Run button uses the browser and never creates a submission; official Submit continues through NOJV's existing server pipeline until parity is proven.

**Tech Stack:** `@wasm-oj/browser@0.2.0` plus explicit `@wasm-oj/toolchain-*` npm packages, Wasmer runtime, SvelteKit browser Workers, existing NOJV `SubmissionResult` mapping, Vitest integration tests.

## Decisions

- Do not replace Advanced Mode or the existing checker/interactor protocol.
- Preserve NOJV's existing output display and verdict model at the UI boundary.
- Treat WASM-OJ's instruction-cost/linear-memory metrics as measurements first; do not silently map them to existing CPU/RSS limits until calibration data exists.
- Pin the published WASM-OJ package versions and toolchain asset descriptors; each browser fetch is verified by the package's descriptor digest.

## Success criteria

1. Local Run executes standard sample/custom cases without creating a server submission.
2. Supported language source files and multi-file workspace files compile and run in the browser.
3. The browser result mapping reuses NOJV's existing verdict and output contracts.
4. Official Submit remains on the existing server executor and production verdicts do not depend on browser execution.
5. Advanced Mode, checker, and interactive cases keep their existing path.

## Implementation order

1. Add a small WASM-OJ browser host/adapter boundary and pinned asset configuration.
2. Add browser engine bootstrap with required isolation headers and explicit toolchains.
3. Route the existing editor Run action to local browser execution for supported standard cases.
4. Keep official Submit on the existing server pipeline.
5. Add tests for mapping, cancellation, compile errors, multi-file sources, and output matching.
6. Collect a larger legacy-executor parity and performance corpus before considering server cutover.

## First measurement

An earlier local Apple Silicon Forge server-mode benchmark compiled a three-case
C++ add program and verified all three outputs. It measured 2,874 ms cold compile
time, 2 ms warm compile time, and 94.3 ms warm p50 execution. This historical
Forge-only measurement is not a current production latency claim or a legacy
executor parity result; a larger comparison corpus remains deferred.

## Explicitly deferred

- WASM-OJ judge-package/Organizer adoption.
- A larger legacy-executor parity/performance benchmark corpus.
- Replacing NOJV checker/interactor and Advanced Mode.
- Switching official Submit to browser execution.
- Converting wall-clock/RSS limits into WASM-OJ instruction/logical-time policies.
