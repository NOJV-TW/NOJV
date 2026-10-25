# Shared package agent guide

Read the owning package README and the [dependency rules](../docs/architecture/ARCHITECTURE.md#dependency-rules) before editing. The [package index](README.md) identifies each owner.

## Working rules

- No package imports an app. Keep workspace dependencies within the architecture table and existing lint guards.
- Keep schemas and pure shared contracts in `core`; it has no workspace dependencies. Put product authorization and transaction orchestration in `application`.
- Use existing public package entries. Do not add compatibility re-exports after internal moves or introduce abstractions without a current consumer.
- Check all consumers when changing an exported schema, type or runtime contract. Tests live in the repository-root `tests/` tree.

## Read by capability

| Package        | Local guide                                                      | Shared source                                                                |
| -------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| core           | [README](core/README.md)                                         | [Judge pipeline](../docs/architecture/JUDGE_PIPELINE.md) for judge contracts |
| application    | [AGENTS](application/AGENTS.md), [README](application/README.md) | Owning [feature spec](../docs/features/)                                     |
| db             | [AGENTS](db/AGENTS.md), [README](db/README.md)                   | [Database schema](../docs/architecture/DATABASE.md)                          |
| redis          | [README](redis/README.md)                                        | [Keys, channels and cache](../docs/architecture/REDIS.md)                    |
| storage        | [README](storage/README.md)                                      | [Object storage](../docs/architecture/ARCHITECTURE.md#object-storage)        |
| temporal       | [README](temporal/README.md)                                     | [Orchestration](../docs/architecture/ARCHITECTURE.md#temporal-orchestration) |
| mailer         | [README](mailer/README.md)                                       | [Architecture](../docs/architecture/ARCHITECTURE.md)                         |
| sandbox-docker | [README](sandbox-docker/README.md)                               | [Security](../docs/operations/SECURITY.md)                                   |

## Verify

Use the owning README's package commands from the repository root. Choose affected consumer tests using the [testing strategy](../docs/runbooks/testing.md). For dependency-boundary changes, run `pnpm exec vitest run --project unit tests/unit/infra/package-boundaries.test.ts` and the affected packages' lint commands.
