# AGENTS.md

This file is the agent entrypoint for this repository. Read it first, then follow the linked living documents instead of treating `README.md` as the full source of truth.

## Start by task

Read the first matching row, then inspect the owning app or package guide and
source. Do not read every architecture document for a routine change.

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
| Designing or planning any non-trivial change         | [Decision log](docs/decisions/README.md), then [Planning](#planning-and-decisions) |
| Which runbook for an operational task                | [Runbooks Index](docs/runbooks/README.md)                                     |
| Local dev setup, first run, troubleshooting          | [Getting Started](docs/runbooks/getting-started.md)                           |
| Outage response, SLO breach, recovery steps          | [Incident Recovery](docs/runbooks/incident-recovery.md)                       |
| Backup posture, PITR, GCS / Redis snapshot restore   | [Backup & Restore](docs/runbooks/backup-restore.md)                           |
| Setting up or updating Grafana metrics dashboards    | [Observability Setup](docs/runbooks/observability-setup.md)                   |
| Where new tests belong, how to run each layer        | [Testing Strategy](docs/runbooks/testing.md)                                  |
| Cross-cutting quality / tech debt                    | [Quality Ledger](docs/operations/QUALITY_SCORE.md)                            |
| Overall system map, layer boundaries                 | [Architecture Overview](docs/architecture/ARCHITECTURE.md)                    |
| Feature acceptance specs (assignments, exams, etc.)  | [Feature Specs](docs/features/) — per-feature Given/When/Then                 |
| Any other task or full documentation index           | [Documentation home](docs/README.md)                                          |

## Planning and decisions

[Superpowers](https://github.com/obra/superpowers) is the planning workflow. Its specs go to `docs/superpowers/specs/` and plans to `docs/superpowers/plans/`; those folders hold only in-flight work.

1. Before brainstorming or writing a plan, read the [decision index](docs/decisions/README.md), the entries for the areas you touch, and the owning living doc.
2. A design that contradicts a decision says so explicitly and updates or replaces that entry in the same PR, keeping the old choice as a `Rejected:` line.
3. The PR that ships the work also updates the owning living doc, adds or updates decision entries for durable choices (with `Source:` linking the PR), and deletes its spec and plan files. Git history keeps the process record.
4. Parked work keeps its plan only while someone intends to finish it; otherwise record the open item in the [Quality Ledger](docs/operations/QUALITY_SCORE.md) and delete the plan.

## Doc Authoring Rules

- Living docs (`architecture/`, `operations/`, `product/`, `features/`, `runbooks/`) describe current behavior only; no history, dated narratives, or "previously". Rationale belongs in `docs/decisions/`.
- Each doc has ONE purpose (see table above). Don't duplicate content across docs — link instead.
- If a topic doesn't fit any existing doc, extend the closest one rather than creating a new untracked doc.

## Quick Reference

- **Monorepo**: pnpm 11.13.1 workspaces + Turborepo, Node.js >=24.18 <25, ESM
- **Frontend**: SvelteKit + Vite + Tailwind CSS 4 + Bits UI + Monaco Editor
- **Auth**: better-auth (GitHub + Google OAuth; admin credentials + expiring exam passwords; passkeys for step-up)
- **Orchestration**: Temporal (TypeScript SDK)
- **Database**: PostgreSQL 18, Prisma 7
- **Cache**: Redis 8 (pub/sub, rate limiting, cooldown, hot cache)
- **Object Storage**: S3-compatible (MinIO local, GCS/R2/S3 production) via `@nojv/storage`
- **Validation**: Zod 4 everywhere (schemas in `@nojv/core`)
- **Testing**: Vitest (unit/component/integration), Playwright (E2E)
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
pnpm test:e2e             # Full local Playwright suite; CI runs a core browser smoke
pnpm ci:verify            # Build, static checks, typechecks, unit + component tests
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
  mailer/           SMTP and local sink
  sandbox-docker/   Hardened Docker execution options shared by sandbox modes
  temporal/         Temporal client, dispatch API, queues and workflow I/O types

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
  product/          Product sense
  runbooks/         Getting started, incident recovery, backup/restore, observability
  features/         Per-feature acceptance specs
  decisions/        Durable decisions by area (read before planning)
  superpowers/      In-flight Superpowers specs and plans only
  example-problem/  Sample course problem PDFs + extracted text (referenced by e2e tests)
```

## Rules

- Keep this file navigational; use [docs/README.md](docs/README.md) for the task-to-source/test map.
- Apps and packages own local README files; architecture and operations docs are the shared sources of truth.
- Update the owning living doc in the same change as behavior or architecture changes; plan documents preserve history, not current behavior.
- Keep durable product, architecture, reliability, and security detail in the linked docs.
- Keep the linked docs aligned with landed code instead of preserving speculative or stale future-tense guidance.
- Do not add any unnecessary comments.
