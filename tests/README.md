# Tests

Tests live in the repository-root `tests/` tree so all packages share one
runner configuration. Directory selects the test boundary; the next directory
selects the code domain or runtime.

| Directory      | Boundary                                                       | Command                 |
| -------------- | -------------------------------------------------------------- | ----------------------- |
| `unit/`        | Pure modules and isolated server/domain logic                  | `pnpm test:unit`        |
| `component/`   | Svelte behavior rendered in jsdom/browser-like DOM             | `pnpm test:component`   |
| `integration/` | HTTP, database, Redis, Temporal and real sandbox contracts     | `pnpm test:integration` |
| `e2e/`         | User journeys through a running SvelteKit app and dependencies | `pnpm test:e2e`         |
| `fixtures/`    | Reusable input data and checked-in expected Temporal histories | Used by owning suite    |
| `setup/`       | Explicit database guards, global setup and test binaries       | Used by test scripts    |

Use the real database for persistence contracts; unit tests must not perform
destructive operations. Only the explicitly provisioned and marked test
databases may be truncated. See [Testing Strategy](../docs/runbooks/testing.md)
for prerequisites, isolation rules, and the CI/local verification boundary.
