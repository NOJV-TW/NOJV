# Browser C/C++ stack parity

Goal: let NOJV select the current native environment's 8 MiB stack capacity through a public Forge compile option.

## Implementation

- [Forge #110](https://github.com/wasm-oj/forge/pull/110) adds optional C/C++ `stackSizeBytes` to SDK compile input and project build configuration. Omitting it retains the toolchain default; it is validated at SDK and project boundaries and included in artifact and incremental link cache keys.
- NOJV requests 8 MiB for C/C++ contestant builds and C++ checker/interactor builds. Other languages omit the option.
- The live worker inherits an 8192 KiB stack soft limit; no running sandbox Pod was available for direct inspection. Native stack policy is inherited, not explicitly set by nojv-exec, and native/Wasm recursion behavior remains different.

## Verification

- Forge: 1009 tests passed, 14 skipped; library build, library typecheck, changed-file lint, packed-package and NodeNext consumer checks passed.
- Chromium: the original source traps with the default and 1 MiB settings, and succeeds with 8 MiB. Cache keys differ. C/C++ debug/release builds pass at 7 MiB and trap at 9 MiB under a 16 MiB total memory limit.
- NOJV: using the locally built Forge candidate, the actual browser execution service returns AC and the expected output for the unchanged source. Web check/lint, test typechecks, 138 relevant tests and doc drift checks passed.

## Remaining release dependency

The current published/locked `@wasm-oj/browser@0.2.5` does not expose this option. This draft must not merge until the upstream PR is merged and released, then NOJV's dependency and lockfile must pin that published version and verification must be repeated. Local candidate testing used a temporary node_modules symlink only; no fork, package patch, or file dependency is committed.

When shipping, update JDG-15's Source link to the NOJV PR and delete this plan in the same PR.
