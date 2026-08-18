# Forge Judge Spike Design

**Goal:** Measure Forge's Standard Mode performance and verdict parity while letting users run ordinary sample/custom tests locally in the browser.

**Architecture:** Keep NOJV's Temporal, storage, permissions, submission persistence, scoring, rejudge, checker, interactive, and Advanced Mode boundaries. Add Forge only to the supported C/C++/Rust/Go/Python/JavaScript/TypeScript Standard/local execution paths. The local Run button uses Forge in the browser and never creates a submission; official Submit continues through NOJV's existing server pipeline until parity is proven.

**Tech Stack:** `@wasm-oj` Forge browser/server packages pinned to one immutable Forge revision, Wasmer runtime, SvelteKit browser Workers, existing NOJV `SubmissionResult` mapping, Vitest integration tests.

## Decisions

- Do not add Java support to Forge in this spike.
- Do not replace Advanced Mode or the existing checker/interactor protocol.
- Preserve NOJV's existing output display and verdict model at the UI boundary.
- Treat Forge's instruction-cost/linear-memory metrics as measurements first; do not silently map them to existing CPU/RSS limits until calibration data exists.
- Pin Forge artifacts and toolchains by revision/digest because the current GitHub main branch is a workspace release and the published release is experimental.

## Success criteria

1. Local Run executes standard sample/custom cases without creating a server submission.
2. Supported language source files and multi-file workspace files compile and run in the browser.
3. The same corpus can run through the legacy server executor and Forge for comparison.
4. The benchmark records verdict parity, compile success, p95 latency, and peak memory/cost without changing production verdicts.
5. Unsupported Java, Advanced Mode, checker, and interactive cases keep their existing path.

## Implementation order

1. Add a small Forge host/adapter boundary and pinned asset configuration.
2. Add a corpus runner that compares legacy and Forge results.
3. Add browser engine bootstrap with required isolation headers and explicit toolchains.
4. Route the existing editor Run action to local Forge execution for supported standard cases.
5. Add tests for mapping, cancellation, compile errors, multi-file sources, and output matching.
6. Run the benchmark and document measured parity/performance before considering server cutover.

## First measurement

On the local Apple Silicon development machine, `pnpm forge:benchmark` compiled a
three-case C++ add program with Forge server mode and verified all three outputs.
The cold run measured 2,874 ms compile time and 978.6 ms for the first execution;
the warm cache run measured 2 ms compile time, 94.3 ms p50 execution, and 94.9 ms
p95 execution. Forge reported 128 KiB peak linear memory. This is a Forge-only
baseline, not yet a legacy-executor comparison. A repeated warm run measured
96.2 ms p50 and 123.9 ms p95, so the benchmark needs a larger sample before
making a stable latency claim.

## Explicitly deferred

- Java compiler/runtime support.
- Forge judge-package/Organizer adoption.
- Replacing NOJV checker/interactor and Advanced Mode.
- Converting wall-clock/RSS limits into Forge instruction/logical-time policies.
