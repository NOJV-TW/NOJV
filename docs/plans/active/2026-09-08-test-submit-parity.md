# Test and Submit parity

Goal: fix the reported production sample mismatch and remove avoidable differences between browser Test and native Submit.

Architecture: preserve exact stdin in both engines. Reuse existing server execution for selected languages needing hidden workspace files and Python input missing its final LF, which WASM-OJ Python's input() mishandles. Browser runs receive the same configured runtime limits/environment and comparator. Official testcase data and grading answers remain authoritative.

References: [Judge Pipeline](../../architecture/JUDGE_PIPELINE.md), [Frontend](../../architecture/FRONTEND.md).

## Production evidence and repair

Problem `cmtmbr8cg000001m9do64dq81` had three samples without final LF, whereas all 15 official inputs end in LF. Submission `46436b89-b066-4ccb-9066-692de8fc4a06` contains the reported C program and passed 15/15. Its scanf condition treats EOF as success. Native and browser execution both produce NO for unterminated balanced input and YES with LF.

Repaired only the three sample input values in production, appending LF to each. The transaction compared both previous samples and updatedAt and required exactly one changed row. Storage generation stays 12; the reference submission pointer, official testcase objects, outputs, and previous verdicts are unchanged. A local before-state snapshot and post-repair readback live under output/parity-evidence and output/parity-harness. No application release or rejudge was performed.

## Implemented differences

- Removed Python-only stdin rewriting; byte-counting and EOF-sensitive programs receive exact input.
- WASM-OJ 0.2.0 Python input() with stdin abc returns ab; sys.stdin.read() correctly returns abc. Route Python cases with nonempty unterminated stdin to the existing native server path.
- Honor judgeConfig.runtime time, memory, and env in browser execution, with the same problem-limit default as native judging.
- Route languages needing hidden workspace files to the server without exposing hidden contents.
- Treat custom sample runs without expected output as execution-only on the server, matching browser behavior. Official missing answers and unknown indices remain SE; explicit empty expected output still compares.

- Reject empty browser testcase lists instead of vacuous acceptance, and report engine infrastructure exceptions as system_error while compilation rejection remains compile_error.

## Review decision

Rejected globally appending LF to Standard Mode stdin: this would change authoritative input and break correctly authored byte-counting problems. Samples are problem data; their intended newline belongs in the sample itself. Both engines should preserve bytes, not conceal an incorrect EOF loop.

## Inherent differences

Both engines already share compareStandard and language time factors. WASI and native compiler/runtime versions, platform APIs, logical time versus CPU accounting, WASM memory versus cgroup RSS, and output/filesystem limits differ. Browser results are previews; arbitrary platform-sensitive programs or resource-limit boundaries cannot be guaranteed identical. Samples also cover fewer cases than hidden tests. Full native parity requires using the server engine.

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
