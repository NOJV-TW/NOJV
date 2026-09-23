# NOJV documentation

Use this page to find the code, rule, and verification path for a change. The
root [AGENTS.md](../AGENTS.md) is the short repository entrypoint; it links the
current source of truth for each task.

## Find the right source

| Task                                                       | Code entry                                                                            | Read first                                                                                                                     | Verify with                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Add or change a page, form, or API                         | `apps/web/src/routes/`, `apps/web/src/lib/server/`                                    | [Frontend Surface](architecture/FRONTEND.md), [Security](operations/SECURITY.md), matching [feature spec](specs/)              | `pnpm --filter @nojv/web check`, relevant `tests/integration/http/` or `tests/e2e/`                        |
| Change authentication or permission behavior               | `apps/web/src/lib/auth.server.ts`, `packages/application/src/<domain>/`               | [Security](operations/SECURITY.md), [Threat Model](operations/THREAT_MODEL.md), [login spec](specs/login-security.md)          | Relevant auth/domain unit and integration tests                                                            |
| Change problem, course, exam, contest, or submission rules | `packages/application/src/<domain>/`                                                  | [Product Sense](product/PRODUCT_SENSE.md), matching [feature spec](specs/), [Architecture](architecture/ARCHITECTURE.md)       | `tests/unit/application/`, `tests/integration/application/`                                                |
| Change judge or sandbox behavior                           | `apps/worker/src/sandbox/`, `apps/worker/src/activities/`, `apps/sandbox-runner/src/` | [Judge Pipeline](architecture/JUDGE_PIPELINE.md), [Security](operations/SECURITY.md), [Reliability](operations/RELIABILITY.md) | `tests/unit/worker/`, `tests/integration/judge/`; Docker/Kubernetes suites when the execution path changes |
| Change the database schema or a query                      | `packages/db/prisma/schema/`, `packages/db/src/repositories/`                         | [Database Schema](architecture/DATABASE.md), matching [feature spec](specs/)                                                   | `pnpm db:validate`, `pnpm db:docs`, relevant `tests/integration/db/`                                       |
| Change Redis keys, events, or workflow dispatch            | `packages/redis/src/`, `packages/temporal/src/`, owning application domain            | [Redis](architecture/REDIS.md), [Architecture](architecture/ARCHITECTURE.md), [Reliability](operations/RELIABILITY.md)         | Unit tests plus `tests/integration/temporal/` or real Redis integration as applicable                      |
| Change Helm, image build, backup, or deploy behavior       | `infra/charts/`, `infra/docker/`, `infra/gcp/`, `infra/flux/`                         | [Deployment](operations/DEPLOYMENT.md), relevant [runbook](runbooks/README.md), [Reliability](operations/RELIABILITY.md)       | `pnpm lint:helm`, target chart rendering, and config validators                                            |
| Set up local development or run a suite                    | `docker-compose.yml`, `tests/setup/`, `package.json`                                  | [Getting Started](runbooks/getting-started.md), [Testing Strategy](runbooks/testing.md)                                        | Use the exact command for the selected test layer                                                          |
| Review a design, decision, or prior implementation         | `docs/plans/`                                                                         | [Plan index](plans/README.md), [Planning System](product/PLANS.md)                                                             | Check current code and evidence linked by the plan                                                         |

## Documentation ownership

- `architecture/` explains current module boundaries and data flow.
- `product/` describes shipped product behavior and how to manage plans.
- `specs/` defines feature acceptance behavior.
- `operations/` records security, reliability, deployment, and current quality evidence.
- `runbooks/` gives procedures; its [index](runbooks/README.md) links related references.
- `plans/active/` tracks work in progress. `plans/completed/` keeps full historical design and implementation records. A plan is not current product documentation.
- `architecture/DATABASE.generated.md` is generated from Prisma; edit the schema/source and regenerate it with `pnpm db:docs`.

Update the authoritative living document in the same change as a behavior or
boundary change. Link to that document from other pages instead of copying its
rules. Preserve historical plan text and mark its status or superseding plan
explicitly.
