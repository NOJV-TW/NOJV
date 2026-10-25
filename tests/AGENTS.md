# Test agent guide

Read the [suite map](README.md) and [testing strategy](../docs/runbooks/testing.md) before choosing a test boundary.

## Working rules

- Keep tests in this tree as `*.test.ts`. The first directory selects the test boundary; the next selects the domain or runtime.
- Test observable behavior and failure cases. Use unit tests for pure logic, component tests for rendered interaction and integration tests for persistence and service contracts.
- Reuse existing fixtures, setup and the HTTP harness at `integration/http/_harness.ts`. Do not replace real persistence with mocks in integration tests.
- Read the applicable app/package guide when testing its behavior; this directory does not inherit instructions from sibling source directories.
- Preserve marked-database and disposable-cluster guards. Never bypass a safety check to get a suite running.
- Keep generated outputs and local credentials out of fixtures. Do not describe a skipped suite as passing.

## Verify

Run the smallest relevant suite from the repository root using the commands in the [testing strategy](../docs/runbooks/testing.md). When changing shared setup or fixtures, run their consuming suites.

For TypeScript test changes, run `pnpm typecheck:tests`. Documentation guards run with `pnpm exec vitest run --project unit tests/unit/docs/` and `pnpm lint:doc-drift`.
