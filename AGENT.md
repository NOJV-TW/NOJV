# AGENTS.md

This file is the agent entrypoint for this repository. Read it first, then follow the linked living documents instead of treating `README.md` as the full source of truth.

## Reading Order

1. [Architecture Overview](docs/architecture/ARCHITECTURE.md)
2. [Product Sense](docs/product/PRODUCT_SENSE.md)
3. [Frontend Surface](docs/architecture/FRONTEND.md)
4. [Design Rules](docs/architecture/DESIGN.md)
5. [Judge Pipeline](docs/architecture/JUDGE_PIPELINE.md)
6. [Database Schema](docs/architecture/DATABASE.md)
7. [Redis Architecture](docs/architecture/REDIS.md)
8. [Security Requirements](docs/operations/SECURITY.md)
9. [Threat Model](docs/operations/THREAT_MODEL.md)
10. [Reliability Invariants](docs/operations/RELIABILITY.md)
11. [Deployment Guide](docs/operations/DEPLOYMENT.md)
12. [Quality Ledger](docs/operations/QUALITY_SCORE.md)
13. [Planning System](docs/product/PLANS.md)
14. [Getting Started Runbook](docs/runbooks/getting-started.md)
15. [Feature Specs](docs/specs/) — acceptance criteria for core features

## Doc Index by Task

Reading Order above is for onboarding. This table is for task-driven lookup —
when working on a specific area, open the listed doc first.

| Working on...                                        | Read                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| Submission judging flow, subtask scoring, verdicts   | [Judge Pipeline](docs/architecture/JUDGE_PIPELINE.md)                         |
| Async workflows, task queues, workflow IDs           | [Architecture Overview](docs/architecture/ARCHITECTURE.md) → `@nojv/temporal` |
| Schema changes, new tables, Prisma migrations        | [Database Schema](docs/architecture/DATABASE.md)                              |
| Cache keys, pub/sub channels, rate limiting          | [Redis Architecture](docs/architecture/REDIS.md)                              |
| SvelteKit routes, page layout, component hierarchy   | [Frontend Surface](docs/architecture/FRONTEND.md)                             |
| Tailwind tokens, Bits UI usage, visual consistency   | [Design Rules](docs/architecture/DESIGN.md)                                   |
| Sandbox isolation, seccomp, capability drop          | [Security Requirements](docs/operations/SECURITY.md)                          |
| Risk assessment, attacker scenarios                  | [Threat Model](docs/operations/THREAT_MODEL.md)                               |
| Idempotency, health checks, failure modes            | [Reliability Invariants](docs/operations/RELIABILITY.md)                      |
| GKE / Helm chart config, env vars, Cloud Build       | [Deployment Guide](docs/operations/DEPLOYMENT.md)                             |
| Feature scope, product direction, shipped vs planned | [Product Sense](docs/product/PRODUCT_SENSE.md)                                |
| Multi-step work needing checkpoints                  | [Planning System](docs/product/PLANS.md) → write plan in `docs/plans/active/` |
| Which runbook for an operational task                | [Runbooks Index](docs/runbooks/README.md)                                     |
| Local dev setup, first run, troubleshooting          | [Getting Started](docs/runbooks/getting-started.md)                           |
| Outage response, SLO breach, recovery steps          | [Incident Recovery](docs/runbooks/incident-recovery.md)                       |
| Backup posture, PITR, GCS / Redis snapshot restore   | [Backup & Restore](docs/runbooks/backup-restore.md)                           |
| Setting up or updating Grafana metrics dashboards    | [Observability Setup](docs/runbooks/observability-setup.md)                   |
| Where new tests belong, how to run each layer        | [Testing Strategy](docs/runbooks/testing.md)                                  |
| Cross-cutting quality / tech debt                    | [Quality Ledger](docs/operations/QUALITY_SCORE.md)                            |
| Overall system map, layer boundaries                 | [Architecture Overview](docs/architecture/ARCHITECTURE.md)                    |
| Feature acceptance specs (assignments, exams, etc.)  | [Feature Specs](docs/specs/) — per-feature Given/When/Then                    |

## Doc Authoring Rules

- Each doc has ONE purpose (see table above). Don't duplicate content across docs — link instead.
- If a topic doesn't fit any existing doc, extend the closest one rather than creating a new untracked doc.
- Plans live in `docs/plans/active/YYYY-MM-DD-short-topic.md`; move to `completed/` when shipped. See [Planning System](docs/product/PLANS.md).

## Quick Reference

- **Monorepo**: pnpm workspaces + Turborepo, Node.js >= 24, ESM throughout
- **Frontend**: SvelteKit + Vite + Tailwind CSS 4 + Bits UI + Monaco Editor
- **Auth**: better-auth (GitHub + Google OAuth; password sign-in admin-only; passkeys for step-up)
- **Orchestration**: Temporal (TypeScript SDK)
- **Database**: PostgreSQL 18, Prisma 7
- **Cache**: Redis 8 (pub/sub, rate limiting, cooldown, hot cache)
- **Object Storage**: S3-compatible (MinIO local, GCS/R2/S3 production) via `@nojv/storage`
- **Validation**: Zod 4 everywhere (schemas in `@nojv/core`)
- **Testing**: Vitest (unit/integration), Playwright (E2E)
- **Sandbox**: Docker (local) or Kubernetes (production) with seccomp + capability drop

## Common Commands

```bash
pnpm install              # Install dependencies
pnpm dev                  # Start all dev servers
pnpm build                # Build all packages and apps
pnpm lint                 # ESLint check
pnpm format               # Prettier check
pnpm format:write         # Prettier fix
pnpm test:unit            # Vitest unit tests
pnpm test:integration     # Vitest integration tests
pnpm test:e2e             # Playwright E2E tests (local only, not in CI)
pnpm ci:verify            # Full CI pipeline locally
pnpm db:generate          # Regenerate Prisma client
pnpm db:push              # Push schema to DB (dev)
pnpm db:migrate           # Run migrations (production)
pnpm db:seed              # Seed database
pnpm sandbox:build        # Build sandbox Docker image
```

## Repository Layout

```
apps/
  web/              SvelteKit frontend + SSR API routes
  worker/           Temporal worker — submission judging, lifecycle orchestration
  sandbox-runner/   Isolated container runtime for code execution

packages/
  core/             Shared Zod schemas, types, pipeline definitions
  db/               Prisma 7 schema, migrations, repositories
  application/      Business logic — queries, mutations, scoring, stats (@nojv/application)
  redis/            Redis connection, key registry, pub/sub
  storage/          S3-compatible object storage (problem images)
  temporal/         Temporal client + dispatch API + task queues + workflow I/O types (workflows/activities live in apps/worker)

tooling/
  eslint/           Shared ESLint 9 flat config
  prettier/         Shared Prettier config
  typescript/       Shared TypeScript config

scripts/            Repo-level maintenance scripts (lint guards, etc.)

infra/
  charts/nojv/      Helm umbrella chart — the single deploy path (single-machine k8s + GKE)
  docker/           Dockerfiles (web, worker, sandbox, migrator)
  gcp/              Cloud Build (image build) + GKE / Temporal / backup helpers
  grafana/          Grafana Cloud dashboards + provisioning script

tests/              Vitest + Playwright test suites
docs/
  architecture/     System, frontend, database, redis, judge pipeline, design rules
  operations/       Deployment, reliability, security, threat model, quality ledger
  product/          Product sense, planning system
  runbooks/         Getting started, incident recovery, backup/restore, observability
  specs/            Per-feature acceptance specs
  plans/            Active + completed design plans
  example-problem/  Sample course problem PDFs + extracted text (referenced by e2e tests)
```

## Rules

- Keep this file short and navigational.
- Keep durable product, architecture, reliability, and security detail in the linked docs.
- Keep the linked docs aligned with landed code instead of preserving speculative or stale future-tense guidance.
- Do not add any unnecessary comments.
