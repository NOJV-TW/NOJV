# Test reliability and judging consistency

**Goal:** Fix reproducible failures and false verdicts in Test, verify every supported language under production CSP, and compare the actual Test/Submit contracts.

**Architecture:** Reuse the current execution and comparison services. Repair the shared WASM runtime binding, language adapters and compiler toolchains. Client-side Test is a firm product requirement to keep execution cost off the server. Do not introduce server fallback. Improve WASM toolchains, language APIs, workspace assembly and resource behavior against native sandbox fixtures; measure and disclose irreducible differences instead of treating server execution as the solution.

**Scope:** NOJV worktree `codex/test-reliability` at `fe95c2b8`; upstream forge worktree of same branch at `c903dd7`. Production baseline is v1.1.1 / `358daeb1`. Existing root-workspace changes are untouched. User authorized PR publication, admin merge after current CI passes, and a new production release on 2026-09-09. Deployment remains pending the upstream SDK release.

## Evidence and constraints

- Prior audit: `/Users/takala/code/NOJV/output/csp-audit/report.md` plus raw before/after results. Eight languages have a runtime CSP failure; Go encounters it during compiler execution.
- CSP must continue to forbid JavaScript eval. Preserve redirected stdio, exact input bytes, and denied-capability isolation.
- Native Node and QuickJS APIs, Java classlib coverage, hidden workspace dependencies, logical fuel vs CPU time, and linear vs process memory are active compatibility targets. Do not claim full equivalence from a hello-world smoke test.
- Read [Judge Pipeline](../../architecture/JUDGE_PIPELINE.md), [Testing](../../runbooks/testing.md), and [Security](../../operations/SECURITY.md).

## Work and validation

1. Establish installed-dependency baseline and trace current call sites for source assembly, custom/sample data, environment, comparison, verdict aggregation, cancellation and timeout behavior.
2. Replace runtime stdio dynamic function with typed host functions; remove other reachable eval-requiring capability guards using existing dependencies. Run focused Rust tests and rebuild the actual web runtime.
3. Preserve source diagnostics as CE and compiler/toolchain/infrastructure faults as SE in Java's browser and server adapters. Reproduce missing artifact after exit-0 compile errors and retain original messages.
4. Fix confirmed NOJV input/result/lifecycle defects with failing tests. Preserve expected-empty output separately from missing expected output. Keep hidden content private while diagnosing missing public Test dependencies.
5. Build affected packages and run a real browser test corpus with the production CSP: all eight languages, newline/EOF/raw input, invalid source, stdout/stderr, empty expected output, cancellation, output/timeout boundaries. Compare supported programs with the native sandbox image and explicitly record platform/API differences.
6. Run relevant unit/component/integration/type/lint/build checks, independently review changes, document remaining concrete limitations and integration/release status.

## Progress

- [x] Refreshed both remotes; isolated current main checkouts and installed lockfiles.
- [x] Exact production CSP baseline and eight-language root failure reproduced in preceding audit.
- [x] Runtime source repair, Rust tests, rebuilt packages, actual strict-CSP browser verification.
- [x] Replace the corrupt legacy Java compiler with WasmGC; static CSP-safe bindings, Scanner/CLDR/Unicode and compiler-metadata entry selection.
- [x] NOJV contract/lifecycle fixes, output budget, native compiler scratch/memory separation, K8s request-limit validation.
- [x] Actual production-bundle probes and native DockerExecutor matrix; 3203 unit + 57 component tests and type/lint/build checks.
- [x] Independent source reviews and investigation report: `output/test-reliability/report.md`.
- [x] User confirmed client-side Test is mandatory; remove server-execution tradeoff from the plan.
- [x] Repair JS ESM / TS Node16 I/O, Python source execution and 16 MiB startup, public workspace contracts, actual guest timing and host sleep cleanup.
- [x] Confirm Python syntax reporting crosses the SDK default fuel limit within one second; use the existing maximum instruction ceiling and enforce the configured host wall deadline in NOJV.
- [x] Complete final Java clean-source/entrypoint proof, bounded result-collection timing, integrated 23-case browser/native comparison and final package verification (949 Forge tests, 13 packed packages, toolchain/contract/license closure).
- [ ] Publish repaired upstream SDK, update NOJV dependency, run remote CI and deploy if authorized.
