# Application agent guide

Read the [module guide](README.md), the owning [feature spec](../../docs/features/) and relevant [decisions](../../docs/decisions/README.md).

## Working rules

- Own business authorization, mutations, queries and transaction orchestration here. Accept plain parameters; keep `RequestEvent`, redirects and HTTP serialization in web.
- Access persistence through `@nojv/db` repositories. Keep query details in their repository rather than duplicating Prisma conditions in domains.
- Reach workflow dispatch through `DomainOrchestrationAdapter`; do not import Temporal SDKs or `@nojv/temporal`.
- Compose multiple domain reads for a page in its page-view query. Keep queries and mutations within the owning domain and expose them through its public namespace.
- Follow [reliability invariants](../../docs/operations/RELIABILITY.md) for transaction boundaries, durable work and retries. Reuse the existing storage pointer-swap and cleanup flow for object lifecycle changes.
- Update the owning feature or architecture document when observable behavior changes.

## Verify

From the repository root, run `pnpm -F @nojv/application typecheck`, `pnpm -F @nojv/application lint` and relevant tests under `tests/unit/application/`.

Persistence and cross-service behavior require the corresponding integration tests under `tests/integration/application/`; cover authorization failures as well as success. Use the [testing strategy](../../docs/runbooks/testing.md) for setup.
