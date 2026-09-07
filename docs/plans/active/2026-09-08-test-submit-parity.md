# Test and Submit parity

Goal: fix the reported production sample mismatch and remove avoidable differences between browser Test and native Submit.

Architecture: preserve exact stdin in both engines. Keep Standard Test in the browser for every supported language and fix WASM runtime defects upstream. Browser runs receive the same configured runtime limits/environment and comparator. Official testcase data and grading answers remain authoritative.

References: [Judge Pipeline](../../architecture/JUDGE_PIPELINE.md), [Frontend](../../architecture/FRONTEND.md).

## Production evidence and repair

Problem `cmtmbr8cg000001m9do64dq81` had three samples without final LF, whereas all 15 official inputs end in LF. Submission `46436b89-b066-4ccb-9066-692de8fc4a06` contains the reported C program and passed 15/15. Its scanf condition treats EOF as success. Native and browser execution both produce NO for unterminated balanced input and YES with LF.

Repaired only the three sample input values in production, appending LF to each. The transaction compared both previous samples and updatedAt and required exactly one changed row. Storage generation stays 12; the reference submission pointer, official testcase objects, outputs, and previous verdicts are unchanged. A local before-state snapshot and post-repair readback live under output/parity-evidence and output/parity-harness. No application release or rejudge was performed.

## Implemented differences

- Removed Python-only stdin rewriting; byte-counting and EOF-sensitive programs receive exact input.
- WASM-OJ 0.2.0 incorrectly reports redirected stdio as a terminal. Python input() consequently strips the final character at EOF. Fix fd_fdstat_get in the upstream shared WASI runtime; no server fallback or input rewriting.
- Honor judgeConfig.runtime time, memory, and env in browser execution, with the same problem-limit default as native judging.
- Treat custom sample runs without expected output as execution-only on the server, matching browser behavior. Official missing answers and unknown indices remain SE; explicit empty expected output still compares.

- Reject empty browser testcase lists instead of vacuous acceptance, and report engine infrastructure exceptions as system_error while compilation rejection remains compile_error.

## Review decision

Rejected globally appending LF to Standard Mode stdin: this would change authoritative input and break correctly authored byte-counting problems. Samples are problem data; their intended newline belongs in the sample itself. Both engines should preserve bytes, not conceal an incorrect EOF loop.

## Inherent differences

Both engines already share compareStandard and language time factors. WASI and native compiler/runtime versions, platform APIs, logical time versus CPU accounting, WASM memory versus cgroup RSS, and output/filesystem limits differ. Browser results are previews; arbitrary platform-sensitive programs or resource-limit boundaries cannot be guaranteed identical. Samples also cover fewer cases than hidden tests.

## Validation

- [x] Trace browser, worker, source merge, stdin, comparison, and result flow.
- [x] Baseline 24 focused tests pass; regression failures reproduced before fixes.
- [x] Independent review caught and removed authoritative-input mutation.
- [x] Real browser/native C parity checked for three inputs with and without LF.
- [x] Real browser reproduction confirmed Python input()/read() EOF behavior.
- [x] Production sample-only repair committed and read back.
- [x] Actual browser and native execution of production samples + official inputs: 18/18 AC, identical stdout per case.
- [x] Final unit suite: 335 files, 2,836 tests passed. Editor component: 4 tests passed.
- [x] Web/core/worker type checks, tests type checks, changed production-source ESLint, Prettier, and diff whitespace checks passed.
- [x] Independent final review: no actionable findings.

The code fixes remain on codex/test-submit-parity and require application release; the sample data repair is already live.

## Upstream WASM fix

[wasm-oj/forge PR #78](https://github.com/wasm-oj/forge/pull/78) fixes the shared WASI fd_fdstat_get import, which incorrectly described redirected stdio as CharacterDevice. CPython selected its interactive input branch and stripped the final byte at EOF. The adapter reports Unknown (WASI has no FIFO type) while preserving errno, rights, flags, and non-stdio metadata.

Removed the proposed server-routing gates from this NOJV branch. Standard Test remains browser-local for all eight supported languages, with exact stdin bytes. The upstream runtime fix still needs to be merged and released before NOJV can consume a published dependency update; no application deployment was performed.

Validation of upstream commit 98cad7b: 84 Rust runtime/CLI tests, 12 conformance unit tests, WASM runtime and 13 package builds, and actual Chromium execution of all eight languages plus two EOF/raw-stdin cases (10 cases, twice each) passed. Browser probes for abc, one character, Unicode, empty stdin, and final LF passed. The reported C loop matches native results on six LF/EOF variants. NOJV after removing the gates: 31 browser-service tests, test typecheck, changed-source lint, and whitespace checks passed.

## Expanded native I/O comparison

The initial eight-language smoke test did not prove native standard-library compatibility. A follow-up matrix ran 266 input/program combinations against the patched browser engine and local Linux sandbox image 8e60a6ef07bf (GCC 15.2, Rust 1.96.1, Go 1.26.3, OpenJDK 21.0.12, Python 3.14.7, Node 24.18.0, TypeScript 6.0.3). C, C++, Python, Rust, and Go each matched native stdout/stderr/exit on 33 cases: raw bytes, line reads, integer tokens, empty/LF/unterminated input, CRLF/bare CR, spaces/tabs, Unicode/BOM/NUL, an 8,193-byte line, and 64-bit integers. Input/API adaptation for QuickJS was labeled separately; it is not Node source compatibility.

Additional defects: the QuickJS std input shim returned the full input on every readAsString call. The upstream PR now consumes input and returns EOF on subsequent reads; JS and TS each passed the 14 raw-input cases after this fix. Node require('fs') is not supported by this QuickJS runtime. Java Scanner and several raw/formatting APIs fail to compile; a System.in.read/print-char probe hit the 185-second compiler limit. These are unresolved toolchain/API gaps, not stdin normalization defects. No server fallback was added.

DOMjudge reference source 3a45e072c846f9862e729854082ed493535a4db4 was checked directly: ImportProblemService.php preserves input bytes and warns about CR; compare.cc normalizes output token whitespace. The existing NOJV DOMjudge contract is the provisional target because the user's exact OpenJudge project/version is still unconfirmed. The shared NOJV comparator now uses ASCII whitespace/case rules and decimal.js for precise numeric comparison, including NaN/Inf and hex floats. All 22 comparison fixtures match the reference validator compiled inside the Linux sandbox. Both browser and worker call this shared comparator.

The upstream corpus contains 112 cases (14 per language), checked against actual browser results. Java coverage uses BufferedReader.readLine, which matched Linux for all 14 inputs; it does not cover the failing raw/Scanner APIs. QuickJS uses its supported std.in.readAsString API rather than Node fs. Comparator regressions also cover 2^100 hex conversion, native-range overflow, and bounded conversion of a 100,000-digit hex token. Extreme long-double rounding boundaries remain platform-dependent.

Local evidence: output/io-parity under this worktree (validator cases/results and full unit log) and the forge-python-stdin worktree (matrix, native/browser results, differences, probes). After rebasing onto main 02df37ef and refreshing dependencies, the NOJV full unit suite passes: 343 files, 2,969 tests. Published-dependency adoption and production deployment remain outstanding; Java/Node API compatibility is not claimed.
