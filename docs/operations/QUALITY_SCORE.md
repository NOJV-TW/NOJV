# Quality and Verification Ledger

This ledger records what was checked and where current rules live. It is a snapshot, not a substitute for running the checks again. Implementation merged to `main` does not prove production deployment or live behavior.

## Verified baseline

The clean baseline at `fb9f34e5d4a56c927d04f4a4d0b7327e7a238ca0` was checked on 2026-09-24 with Node `24.19.0` and the locked pnpm version. `pnpm ci:verify` passed formatting, repository guards, build, typecheck, lint, 384 unit test files (3,555 passed, 2 skipped), and 43 component test files (105 passed). `pnpm install --frozen-lockfile` also passed for all 15 workspace projects.

That command does not run the full integration suite, the full Playwright suite, real Docker/Kubernetes judge checks, `pnpm db:seed:validate`, Helm rendering, a current GitHub Actions run, or production acceptance. Those results are not claimed by this baseline. See the current [verification matrix](../runbooks/testing.md) for commands and boundaries.

## Authoritative guidance

| Topic                                                      | Current source of truth                                                                                                 | Change it when                                                                           |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Overall dependency layers and runtime entry points         | [Architecture](../architecture/ARCHITECTURE.md)                                                                         | A workspace dependency, runtime boundary, or cross-app flow changes.                     |
| Browser routes, components, and server-only boundaries     | [Frontend](../architecture/FRONTEND.md)                                                                                 | A route, browser/server boundary, or shared UI ownership changes.                        |
| Judge and recovery contracts                               | [Judge pipeline](../architecture/JUDGE_PIPELINE.md) and [Reliability](../operations/RELIABILITY.md)                     | A verdict, retry, cancellation, timeout, or recovery contract changes.                   |
| Database models and exact fields                           | [Database overview](../architecture/DATABASE.md); field reference is [generated](../architecture/DATABASE.generated.md) | Edit Prisma schema and regenerate with `pnpm db:docs`; never hand-edit generated output. |
| Security requirements and attacker model                   | [Security](../operations/SECURITY.md) and [Threat model](../operations/THREAT_MODEL.md)                                 | A trust boundary, sensitive data flow, or sandbox capability changes.                    |
| Deploy and operational procedures                          | [Deployment](../operations/DEPLOYMENT.md) and the relevant [runbook index](../runbooks/README.md)                       | A shipped deployment or recovery step changes.                                           |
| Feature acceptance                                         | [Feature specs](../specs/)                                                                                              | User-visible behavior or API acceptance changes.                                         |
| Decisions, trade-offs, and historical implementation plans | [Plan index](../plans/README.md)                                                                                        | A multi-step decision is made or a plan's completion evidence changes.                   |

## Known review work

The current cleanup is tracked in [Codebase clarity](../plans/active/2026-09-24-codebase-clarity.md). It is rechecking package ownership and dependency rules, test taxonomy, worker sandbox organization, living-doc currentness, and status claims in plans. Until that review lands, the baseline above describes only the verified code revision and commands; it does not certify every document or runtime path.

Historical quality grades and milestone narratives were removed because they lacked a current measurement boundary. Consult the linked source document for present rules and the plan archive for the original decision context.

## Evidence rules

- Record date, source revision, exact command, scope, and result for checks that support a current quality claim.
- Keep local, CI, production, and live-behavior evidence distinct.
- Treat configured CI jobs as policy, not proof that the latest revision passed. Read the run for the revision being reviewed.
- Report integration, browser, container, cluster, and production checks only when they actually ran against an isolated target.
