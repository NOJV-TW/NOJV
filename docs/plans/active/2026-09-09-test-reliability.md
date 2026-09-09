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
- [x] Repair JS ESM / TS Node16 I/O, Python source execution and 16 MiB startup, public workspace contracts, execution lifecycle cleanup.
- [x] Record Python diagnostic fuel exhaustion as a platform difference; preserve Forge instruction metering and deterministic time.
- [x] Complete final Java clean-source/entrypoint proof, bounded result-collection timing, integrated 23-case browser/native comparison and final package verification (949 Forge tests, 13 packed packages, toolchain/contract/license closure).
- [ ] Publish repaired upstream SDK, update NOJV dependency, run remote CI and deploy if authorized.

## Modification-boundary reassessment (2026-09-09)

The user requested a fresh assessment before merging or deploying. Release is paused. The original CSP incident is an integration incompatibility, not evidence that every Forge change is necessary to fix CSP.

### Decision

Keep NOJV's existing document CSP and the client-only architecture. Keep product policy in NOJV and generic execution/toolchain repairs in Forge. Do not replace Forge, copy its implementation into NOJV, or ship a runtime monkey patch. An NOJV-only CSP relaxation can address the original eval rejection, but cannot meet the full requirement of working standard input, language diagnostics, and reasonable sandbox parity across all eight languages.

| Boundary                                                                         | Owner and chosen implementation                                                                                                   | Why NOJV configuration alone is insufficient or sufficient                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Document CSP and client-only routing                                             | NOJV; retain `wasm-unsafe-eval`, omit `unsafe-eval`                                                                               | Policy belongs to the host. No extra WebAssembly permission is missing.                                                                                                                                                                                                                                |
| WASI dynamic host bindings                                                       | Forge runtime; typed bindings with capability denial preserved                                                                    | The SDK exposes no switch for replacing the dynamic binding factory. This is not student JavaScript.                                                                                                                                                                                                   |
| Worker-specific CSP exception                                                    | Not selected                                                                                                                      | The current compiler/runner use blob bootstraps, which inherit the creating context's CSP. A header on the imported JS asset does not replace that policy. Direct URL workers would require SDK worker construction and deployment-header changes.                                                     |
| Separate relaxed-CSP execution origin                                            | Not selected for this repair                                                                                                      | Technically possible, but requires an origin, asset delivery, message validation and cross-origin isolation design. It still does not repair Java/Python/QuickJS defects.                                                                                                                              |
| Time, fuel, output comparison and grading                                        | NOJV selects logical-time/memory/output budgets and comparison; Forge owns deterministic time and default instruction/wall limits | Forge's deterministic virtual clock and weighted instruction budget are intentional replay features, not bugs. Preserve their defaults. Wall time remains different from native CPU time.                                                                                                              |
| Execution start/end observation, cancellation and cleanup                        | Forge provides lifecycle facts; NOJV presents local execution time                                                                | Host infrastructure time must not silently become student runtime. These facts cannot be reconstructed reliably around an outer `engine.run()` call.                                                                                                                                                   |
| Source bytes, expected-empty output, workspace visibility and request validation | NOJV                                                                                                                              | These are application contracts and require no Forge product dependency.                                                                                                                                                                                                                               |
| Native compiler scratch/memory, protocol buffers and K8s deadlines               | NOJV sandbox/worker                                                                                                               | Forge is not NOJV's production sandbox implementation.                                                                                                                                                                                                                                                 |
| Java compiler/classlib, Python minimum memory, binary stdio and promise failures | Forge toolchain/runtime                                                                                                           | These remain broken independently of document CSP. Source rewriting or translating an infrastructure error into a verdict cannot make a valid program execute.                                                                                                                                         |
| JavaScript/Python source packaging and TypeScript Node16 target                  | Explicit versioned Forge language behavior; NOJV consumes the supported profile                                                   | These are compatibility choices, not CSP fixes. Forge must document its supported language semantics and asset identities. NOJV must not claim a full Node/JDK or compiler-version match. Strict TypeScript checking already existed before this PR; the module/target update is separately versioned. |

### Evidence and limits

- Source inspected: NOJV `apps/web/svelte.config.js` and `browser-local-run.ts`; Forge `src/sdk/browser-engine.ts`, `src/runtime/module-worker.ts`, `src/core/types.ts`, deterministic adapters and the TypeScript toolchain. The engine has explicit toolchain sources and runtime-driver plugins; no public compiler-flags/CSP/worker-factory option solves the current failures without implementing another adapter/runtime.
- Fresh Chromium experiment: the same script with a relaxed response CSP permits `new Function` when launched as a direct URL Worker, but rejects it when imported by a blob Worker created under the strict document policy. Recorded in local `output/reassessment/csp.json`; this is a policy-boundary check, not an end-to-end production fix.
- CSP worker inheritance reference: <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy#csp_in_workers>. Wasmer embeds a WASM/WASIX runtime; it does not promise native Linux/Node/JVM equivalence.
- Earlier baseline and static-binding counterfactual already isolate CSP from language defects: all eight minimal programs recover while Java Scanner/compiler diagnostics still fail. These are earlier captured results, not a newly rerun full language corpus.
- A `pnpm patchedDependencies` package could carry the same Forge repair from NOJV, avoiding an upstream merge dependency. It would still be a maintained Forge fork (including rebuilt WASM and compiler assets), not an NOJV configuration-only repair. Prefer normal versioned upstream packages for this extensive toolchain correction; do not hide the maintenance burden in a generated bundle patch.
- Latest upstream CI at commit `1fbf8a0` now passes the Linux stdin test but fails server Python execution with an unsettled `instance.wait()` and missing response file. This server-host regression remains a release blocker even though NOJV uses the browser host. Do not claim Forge's server contract is verified by NOJV browser tests.

### Acceptance before release

The modifications remain separated by repository, with no CSP relaxation or new host infrastructure. Forge language changes must be reviewed as SDK/toolchain behavior, not justified solely by NOJV parity. Fix the current server-host CI failure, publish immutable repaired packages, update NOJV's dependency lock, and rerun the browser/native matrix using installed packages before the previously authorized CI-gated merge and deployment.

## Final time-model correction (2026-09-09)

The user explicitly rejected host-clock mode. Removed it from Forge types, native/browser runtime branches, environment overrides, real-sleep implementation, fixtures and documentation. Unknown clockMode project input is rejected. NOJV no longer selects host clocks or overrides the SDK instruction budget/emergency wall deadline; displayed time is Forge logical time. The earlier native-parity timing proposal is withdrawn. Browser result collection/lifecycle fixes remain separate infrastructure protections. The earlier 23-case parity result used a now-withdrawn policy and is not evidence for the corrected time model. Revalidate under deterministic settings without requiring native timing/verdict equivalence.
