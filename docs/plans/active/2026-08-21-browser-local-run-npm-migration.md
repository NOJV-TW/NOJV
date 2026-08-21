# Browser Local Run npm Migration Implementation Plan

**Goal:** Run standard sample/custom tests in the browser with the published WASM-OJ packages so local runs reduce server load without changing official submissions.

**Architecture:** Replace the deprecated monolithic `@wasm-oj/forge` browser adapter with `@wasm-oj/browser` and explicit published toolchain packages. Copy toolchain assets into the same-origin static directory, create one cached browser engine, prewarm it when a supported editor opens, and keep local execution limited to standard sample/custom runs; official submit, checker, interactive, and special environments remain on the existing server path.

**Tech Stack:** SvelteKit, TypeScript, pnpm workspaces, `@wasm-oj/browser@0.2.0`, published `@wasm-oj/toolchain-*` packages, Vitest, local browser verification.

## Implementation status

- Published browser and toolchain packages are used directly; the deprecated Forge package and patch are removed.
- C, C++, Go, Java, JavaScript, Python, Rust, and TypeScript local runs use one shared browser engine with artifact caching.
- Java browser entry files use `Main.java`.
- Official submission remains on `executeSubmission()` and the server judge pipeline.
- Supported editors prewarm the engine after mount. The Test button shows only `初始化中...` or `測試中...`.

## Verification

- Browser assets are copied to `/wasm-oj/toolchains/` for same-origin loading.
- Standard sample/custom local execution is covered by browser-local mapping tests and a local browser smoke test.
- Web check, lint, build, and relevant unit tests pass on the isolated branch.

## Deferred

- Switching official Submit to browser execution.
- Replacing checker, interactive, or Advanced Mode execution.
- Converting wall-clock/RSS limits into WASM-OJ instruction/logical-time policies.
- WASM-OJ judge-package/Organizer adoption.
