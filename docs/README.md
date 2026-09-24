# NOJV documentation

Use this page to find the code, rule, and verification path for a change. The
root [AGENTS.md](../AGENTS.md) is the short repository entrypoint; it links the
current source of truth for each task.

## Find the right source

For rationale, status and links between overlapping work, use the [plan index](plans/README.md).

| Task                                                 | Code entry                                                                                                                          | Read first                                                                                                                     | Verify with                                                                                                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add or change an HTTP API                            | `apps/web/src/routes/api/**/+server.ts` → owning function in `packages/application/src/<domain>/`                                   | [Frontend](architecture/FRONTEND.md), [Security](operations/SECURITY.md), matching [feature spec](specs/)                      | `pnpm --filter @nojv/web check`; `pnpm exec vitest run --project integration tests/integration/http/`; `pnpm test:e2e`                                               |
| Change exam permissions                              | `packages/application/src/exam/permissions.ts`; exam routes in `apps/web/src/routes/(app)/exams/`                                   | [Security](operations/SECURITY.md), [Threat Model](operations/THREAT_MODEL.md), [exam spec](specs/exams.md)                    | `pnpm exec vitest run --project unit tests/unit/application/exam-permissions.test.ts`; `pnpm test:e2e`                                                               |
| Change judging or sandbox execution                  | `packages/application/src/submission/judge-context.ts`, `apps/worker/src/sandbox/`, `apps/sandbox-runner/src/`                      | [Judge Pipeline](architecture/JUDGE_PIPELINE.md), [Security](operations/SECURITY.md), [Reliability](operations/RELIABILITY.md) | `pnpm exec vitest run --project unit tests/unit/worker/`; `pnpm test:integration:sandbox`; `pnpm test:integration:k8s`                                               |
| Change the database schema or a query                | `packages/db/prisma/schema/`, `packages/db/src/repositories/`                                                                       | [Database Schema](architecture/DATABASE.md), matching [feature spec](specs/)                                                   | `pnpm db:validate`; `pnpm db:docs`; `pnpm exec vitest run --project integration tests/integration/db/`                                                               |
| Diagnose deployment or change Helm config            | `infra/charts/nojv/`, `infra/docker/`, `infra/gcp/`, `infra/flux/`                                                                  | [Deployment](operations/DEPLOYMENT.md), relevant [runbook](runbooks/README.md), [Reliability](operations/RELIABILITY.md)       | `pnpm lint:helm`; `pnpm exec vitest run --project unit tests/unit/infra/`                                                                                            |
| Change authentication or other permissions           | `apps/web/src/lib/auth.server.ts`, `packages/application/src/<domain>/`                                                             | [Security](operations/SECURITY.md), [Threat Model](operations/THREAT_MODEL.md), [login spec](specs/login-security.md)          | `pnpm exec vitest run --project unit tests/unit/web/ tests/unit/application/`; `pnpm exec vitest run --project integration tests/integration/http/`; `pnpm test:e2e` |
| Change problem, course, contest, or submission rules | `packages/application/src/<domain>/`; problem `details/list/picker` and `mutations/`, submission `details/history/judge-context.ts` | [Product Sense](product/PRODUCT_SENSE.md), matching [feature spec](specs/), [Architecture](architecture/ARCHITECTURE.md)       | `pnpm exec vitest run --project unit tests/unit/application/`; `pnpm exec vitest run --project integration tests/integration/application/`                           |
| Change Redis keys, events, or workflow dispatch      | `packages/redis/src/`, `packages/temporal/src/`, owning application domain                                                          | [Redis](architecture/REDIS.md), [Architecture](architecture/ARCHITECTURE.md), [Reliability](operations/RELIABILITY.md)         | `pnpm exec vitest run --project unit tests/unit/`; `pnpm test:integration:temporal`                                                                                  |
| Set up local development or run a suite              | `docker-compose.yml`, `tests/setup/`, `package.json`                                                                                | [Getting Started](runbooks/getting-started.md), [Testing Strategy](runbooks/testing.md)                                        | `pnpm test:unit`; `pnpm test:component`; `pnpm test:integration`; `pnpm test:e2e`                                                                                    |
| Review a design, decision, or prior implementation   | `docs/plans/`                                                                                                                       | [Plan index](plans/README.md), [Planning System](product/PLANS.md)                                                             | Check current code and evidence linked by the plan                                                                                                                   |

## Documentation ownership

- `architecture/` explains current module boundaries and data flow.
- `product/` describes shipped product behavior and how to manage plans.
- `specs/` defines feature acceptance behavior.
- `operations/` records security, reliability, deployment, and current quality evidence.
- `runbooks/` gives procedures; its [index](runbooks/README.md) links related references.
- `plans/active/` tracks work in progress. `plans/completed/` keeps full historical design and implementation records. The [plan index](plans/README.md) links current decisions to their history; plans are not current product documentation.
- `architecture/DATABASE.generated.md` is generated from Prisma; edit the schema/source and regenerate it with `pnpm db:docs`.

Update the authoritative living document in the same change as a behavior or
boundary change. Link to that document from other pages instead of copying its
rules. Preserve historical plan text and mark its status or superseding plan
explicitly.
