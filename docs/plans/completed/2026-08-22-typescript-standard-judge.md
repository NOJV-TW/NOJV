# Standard TypeScript Judge

Status: Completed on 2026-08-22.

## Result

The standard TypeScript judge now has an explicit compile phase:

1. `tsc` runs with strict type-checking and `--noEmitOnError`.
2. JavaScript is emitted under the submission artifact directory.
3. Testcases execute only the emitted JavaScript with Node.js 24.

The canonical judge manifest pins `typescript@6.0.3` and `@types/node@24.13.3`. The sandbox image contains the same compiler toolchain, and compiler diagnostics from stdout/stderr are returned as compilation errors.

## Verification

- `pnpm ci:verify` passed.
- 326 unit test files passed; 2,753 tests passed.
- 15 component test files passed; 21 tests passed.
- Sandbox runner Docker image built successfully.
- Container smoke test confirmed TypeScript compilation, emitted-JavaScript execution, and rejection of invalid types before execution.
- `pnpm exec vitest run --project integration` was not run because it requires the destructive test database and Redis services.
