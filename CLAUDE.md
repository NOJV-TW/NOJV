# CLAUDE.md

This file is the agent entrypoint for this repository. Read it first, then follow the linked living documents.

## Reading Order

1. [Architecture Overview](ARCHITECTURE.md)
2. [Frontend Surface](docs/FRONTEND.md)
3. [Temporal Workflows](docs/TEMPORAL.md)
4. [Judge Pipeline](docs/JUDGE_PIPELINE.md)
5. [Database Schema](docs/DATABASE.md)
6. [Redis Architecture](docs/REDIS.md)
7. [Security Requirements](docs/SECURITY.md)
8. [Reliability Invariants](docs/RELIABILITY.md)
9. [Deployment Guide](docs/DEPLOYMENT.md)
10. [Getting Started Runbook](docs/runbooks/getting-started.md)

## Quick Reference

- **Monorepo**: pnpm workspaces + Turborepo, Node.js >= 24, ESM throughout
- **Frontend**: SvelteKit + Vite + Tailwind CSS 4 + Bits UI + Monaco Editor
- **Auth**: better-auth (email/password, GitHub, Google)
- **Orchestration**: Temporal (TypeScript SDK), replaces BullMQ
- **Database**: PostgreSQL 17, Prisma 7
- **Cache**: Redis 8 (pub/sub, rate limiting, scoreboards, cooldown, hot cache)
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
- Keep durable architecture, security, and reliability detail in the linked docs.
- Keep the linked docs aligned with landed code, not speculative future-tense guidance.
