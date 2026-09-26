# Tests

All tests live in this repo-root tree and share one Vitest and one Playwright
configuration. The first directory selects the test boundary; the next selects
the code domain or runtime.

| Directory          | Boundary                                                                       | Command                     |
| ------------------ | ------------------------------------------------------------------------------ | --------------------------- |
| `unit/`            | Pure modules and isolated server/domain logic                                  | `pnpm test:unit`            |
| `component/`       | Svelte behavior rendered in jsdom                                              | `pnpm test:component`       |
| `integration/`     | HTTP, database, Redis, Temporal (`temporal/`) and sandbox (`judge/`) contracts | `pnpm test:integration`     |
| `integration/k8s/` | Kubernetes sandbox backend on a disposable k3d cluster                         | `pnpm test:integration:k8s` |
| `e2e/`             | User journeys through a running SvelteKit app and dependencies                 | `pnpm test:e2e`             |
| `fixtures/`        | Reusable input data, Helm values and recorded Temporal histories               | Used by the owning suite    |
| `setup/`           | Destructive-database and K8s guards, global setup, test binaries               | Used by the test scripts    |

Only the explicitly provisioned and marked test databases may be truncated.
Prerequisites, isolation rules and the CI/local boundary are in
[Testing Strategy](../docs/runbooks/testing.md).
