# AGENTS.md

This file is the agent entrypoint for this repository. Read it first, then follow the linked living documents instead of treating `README.md` as the full source of truth.

## Reading Order

1. [Architecture Overview](ARCHITECTURE.md)
2. [Product Sense](docs/PRODUCT_SENSE.md)
3. [Frontend Surface](docs/FRONTEND.md)
4. [Design Rules](docs/DESIGN.md)
5. [Temporal Workflows](docs/TEMPORAL.md)
6. [Judge Pipeline](docs/JUDGE_PIPELINE.md)
7. [Database Schema](docs/DATABASE.md)
8. [Redis Architecture](docs/REDIS.md)
9. [Security Requirements](docs/SECURITY.md)
10. [Threat Model](docs/THREAT_MODEL.md)
11. [Reliability Invariants](docs/RELIABILITY.md)
12. [Deployment Guide](docs/DEPLOYMENT.md)
13. [Quality Ledger](docs/QUALITY_SCORE.md)
14. [Planning System](docs/PLANS.md)
15. [Getting Started Runbook](docs/runbooks/getting-started.md)

## Doc Index by Task

Reading Order above is for onboarding. This table is for task-driven lookup —
when working on a specific area, open the listed doc first.

| Working on... | Read |
|---|---|
| Submission judging flow, subtask scoring, verdicts | [Judge Pipeline](docs/JUDGE_PIPELINE.md) |
| Workflow orchestration, task queues, retry policy | [Temporal Workflows](docs/TEMPORAL.md) |
| Schema changes, new tables, Prisma migrations | [Database Schema](docs/DATABASE.md) |
| Cache keys, pub/sub channels, rate limiting | [Redis Architecture](docs/REDIS.md) |
| SvelteKit routes, page layout, component hierarchy | [Frontend Surface](docs/FRONTEND.md) |
| Tailwind tokens, Bits UI usage, visual consistency | [Design Rules](docs/DESIGN.md) |
| Sandbox isolation, seccomp, capability drop | [Security Requirements](docs/SECURITY.md) |
| Risk assessment, attacker scenarios | [Threat Model](docs/THREAT_MODEL.md) |
| Idempotency, health checks, failure modes | [Reliability Invariants](docs/RELIABILITY.md) |
| Cloud Run / GKE config, env vars, Cloud Build | [Deployment Guide](docs/DEPLOYMENT.md) |
| Feature scope, product direction, shipped vs planned | [Product Sense](docs/PRODUCT_SENSE.md) |
| Multi-step work needing checkpoints | [Planning System](docs/PLANS.md) → write plan in `docs/plans/active/` |
| Local dev setup, first run, troubleshooting | [Getting Started](docs/runbooks/getting-started.md) |
| Cross-cutting quality / tech debt | [Quality Ledger](docs/QUALITY_SCORE.md) |
| Overall system map, layer boundaries | [Architecture Overview](ARCHITECTURE.md) |

## Doc Authoring Rules

- Each doc has ONE purpose (see table above). Don't duplicate content across docs — link instead.
- If a topic doesn't fit any existing doc, extend the closest one rather than creating a new untracked doc.
- Plans live in `docs/plans/active/YYYY-MM-DD-short-topic.md`; move to `completed/` when shipped. See [Planning System](docs/PLANS.md).

## Quick Reference

- **Monorepo**: pnpm workspaces + Turborepo, Node.js >= 24, ESM throughout
- **Frontend**: SvelteKit + Vite + Tailwind CSS 4 + Bits UI + Monaco Editor
- **Auth**: better-auth (email/password, GitHub, Google)
- **Orchestration**: Temporal (TypeScript SDK)
- **Database**: PostgreSQL 18, Prisma 7
- **Cache**: Redis 8 (pub/sub, rate limiting, scoreboards, cooldown, hot cache)
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
  domain/           Business logic — queries, commands, scoring, stats
  redis/            Redis connection, key registry, pub/sub, cache, cooldown
  job-dispatch/     Temporal client wrapper, workflow dispatch API
  storage/          S3-compatible object storage (problem images)
  temporal/         Temporal workflows, activities (thin wrappers over domain)

tooling/
  eslint/           Shared ESLint 9 flat config
  prettier/         Shared Prettier config
  typescript/       Shared TypeScript config

infra/
  docker/           Dockerfiles (web, worker, sandbox, migrator)
  gcp/              Cloud Build, Cloud Run, GKE deployment
  k8s/sandbox/      Kubernetes namespace, network policy, resource quota

tests/              Vitest + Playwright test suites
docs/               Design documents, runbooks, specifications
```

## Rules

- Keep this file short and navigational.
- Keep durable product, architecture, reliability, and security detail in the linked docs.
- Keep the linked docs aligned with landed code instead of preserving speculative or stale future-tense guidance.
