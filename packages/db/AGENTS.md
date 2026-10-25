# Database agent guide

Read the [module guide](README.md), [database schema](../../docs/architecture/DATABASE.md) and relevant [data decisions](../../docs/decisions/data.md).

## Working rules

- Encapsulate Prisma queries in repositories. Keep product authorization and business orchestration in application.
- Preserve the public repository and transaction APIs; raw client access is restricted to the existing better-auth adapter exception.
- Respect the separate dependency rules for `src/`, seeds and maintenance scripts in the [architecture](../../docs/architecture/ARCHITECTURE.md#dependency-rules).
- Build databases from committed migrations, never `prisma db push` (ENG-08). Do not rewrite applied migrations; follow the migration guard and existing production schema policy.
- Include SQL-only constraints and triggers when reviewing schema changes. Regenerate Prisma output and database documentation from their sources.
- Use the guarded test-database setup for integration tests; never reset an arbitrary database to make a test pass.

## Verify

From the repository root:

```bash
pnpm db:validate
pnpm lint:migrations
pnpm -F @nojv/db typecheck
```

For schema changes, run `pnpm db:generate` and `pnpm db:docs`, then the affected migration/repository integration tests under `tests/integration/db/`. For query changes, include the relevant `tests/unit/db/` coverage. See the [testing strategy](../../docs/runbooks/testing.md) for prerequisites.
