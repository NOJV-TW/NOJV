# NOJV

Production-oriented Online Judge platform. Supports competitive programming contests (ICPC/IOI), course assessments, practice submissions, and plagiarism detection.

## What Ships Today

- **8 languages**: C, C++, Go, Java, JavaScript, Python, Rust, TypeScript
- **3 judge types**: Standard (diff), Checker (custom script), Interactive (bidirectional I/O)
- **Extensible pipeline**: Static analysis, custom scoring, artifact collection, network access
- **Contests**: ICPC/IOI scoring, real-time scoreboard, freeze, IP lock, page lock
- **Courses**: Membership management, join tokens, assessments with deadlines
- **Plagiarism detection**: Dolos AST similarity (self-hosted, in-process)
- **Auth**: Email/password, GitHub OAuth, Google OAuth
- **i18n**: English + Traditional Chinese (zh-TW)
- **Real-time**: SSE streaming for submission verdicts and contest events
- **Orchestration**: Temporal workflows with durable timers and queries

## Architecture at a Glance

```
Browser ──→ SvelteKit (web) ──→ Temporal Server ──→ Worker ──→ Sandbox
                │                                      │
                ├── PostgreSQL (source of truth)        │
                └── Redis (pub/sub, cache, scoreboard)  │
                                                        ├── Docker (local)
                                                        └── Kubernetes (prod)
```

See [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) for the full architecture overview.

## Repository Map

```
apps/
  web/              SvelteKit frontend + SSR API routes
  worker/           Temporal worker — judging, lifecycle orchestration
  sandbox-runner/   Isolated container runtime for code execution

packages/
  core/             Shared Zod schemas, types, pipeline definitions
  db/               Prisma 7 schema, migrations, seed script
  temporal/         Temporal workflows, activities, task queue definitions

tooling/
  eslint/           Shared ESLint 9 flat config
  prettier/         Shared Prettier config
  typescript/       Shared TypeScript config

scripts/            Repo-level maintenance scripts (lint guards, etc.)

infra/
  docker/           Dockerfiles (web, worker, sandbox, migrator)
  gcp/              Cloud Build, Cloud Run, GKE deployment
  grafana/          Grafana Cloud dashboards + provisioning script
  k8s/sandbox/      Kubernetes namespace, network policy, resource quota

tests/              Vitest + Playwright test suites
docs/
  architecture/     System, frontend, database, redis, judge pipeline, design rules
  operations/       Deployment, reliability, security, threat model, quality ledger
  product/          Product sense, planning system
  runbooks/         Getting started, incident recovery, backup/restore, observability
  playbooks/        Live demo / showcase walkthroughs
  specs/            Per-feature acceptance specs
  plans/            Active + completed design plans
```

## Key Technologies

- **Frontend**: SvelteKit, Vite, Tailwind CSS 4, Bits UI, Monaco Editor
- **Auth**: better-auth (email/password, GitHub, Google)
- **Orchestration**: Temporal (TypeScript SDK)
- **Database**: PostgreSQL 18, Prisma 7
- **Cache**: Redis 8 (pub/sub, rate limiting, scoreboards, cooldown, hot cache)
- **Validation**: Zod 4
- **Testing**: Vitest, Playwright
- **Build**: Turborepo, pnpm workspaces, tsdown, esbuild

## Prerequisites

- Node.js >= 24.0.0
- pnpm 10.x
- Docker Desktop (for local Postgres, Redis, Temporal, and sandbox)

## Local Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env template
cp .env.example .env

# 3. Start infrastructure (Postgres, Redis, MinIO, Temporal, Temporal UI)
docker compose up -d

# 4. Build packages and prepare database
pnpm db:generate
pnpm build
pnpm db:push
pnpm db:seed

# 5. Build sandbox image (needed for submission judging)
pnpm sandbox:build

# 6. Start dev servers
pnpm dev
```

See [Getting Started Runbook](docs/runbooks/getting-started.md) for detailed bootstrap procedures.

### Local Ports

| Service       | URL                   |
| ------------- | --------------------- |
| Web           | http://localhost:5173 |
| PostgreSQL    | localhost:5432        |
| Redis         | localhost:6379        |
| MinIO API     | http://localhost:9000 |
| MinIO Console | http://localhost:9001 |
| Temporal      | localhost:7233        |
| Temporal UI   | http://localhost:8080 |

### Environment Files

| File           | Purpose                                                        |
| -------------- | -------------------------------------------------------------- |
| `.env`         | Database, Redis, Temporal, auth, OAuth, sandbox, worker config |
| `.env.example` | Template with all required variables and defaults              |

## Developer Workflow

Quick verify for judge/pipeline changes:

```bash
pnpm -C packages/core build
pnpm -C apps/sandbox-runner typecheck
pnpm test:unit -- tests/unit/sandbox-runner
pnpm test:integration -- tests/integration/sandbox-runner
```

Full verify before pushing:

```bash
pnpm format        # Prettier check
pnpm format:write  # Prettier fix
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm typecheck
pnpm db:validate
pnpm db:seed:validate
```

## Sandbox Runtime

Submissions execute inside an isolated sandbox container.

- Dockerfile: `infra/docker/sandbox-runner.Dockerfile`
- Image tag: `nojv-sandbox:local`
- Default limits: 1 CPU, 256 MB, 64 pids, `network=none`
- Hardening: `cap-drop ALL`, `no-new-privileges`, read-only rootfs, `tmpfs /tmp`

Build:

```bash
pnpm sandbox:build
```

The worker selects its executor via `EXECUTION_BACKEND` (`docker` locally, `kubernetes` in production).

## CI

- Workflow: `.github/workflows/ci.yml`
- Command: `pnpm ci:verify`
- Checks: formatting, lint, tests, builds, Prisma schema validation, Docker Compose config validation

## CD To Remote Server

- CI workflow: `.github/workflows/ci.yml`
- CD workflow: `.github/workflows/deploy.yml`
- Trigger: CD runs automatically when CI succeeds for a push to `main`
- Deploy target: self-hosted Linux runner on remote server
- Deploy source: exact commit SHA that passed CI

The CD workflow performs Docker Compose based rollout on the remote server:

1. Start/verify infra services (`postgres`, `redis`, `temporal`, `temporal-ui`)
2. Build images for the passed commit (`sandbox-image`, `migrator`, `web`, `worker`)
3. Run database migrations
4. Deploy `web` and `worker`
5. Verify endpoint and container health

Required deployment auth values (one source is enough):

1. `.env` in the remote runner workspace
2. Remote runner environment variables

Required:

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`

Optional OAuth:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Note: the deploy workflow keeps runner local `.env` by using checkout with `clean: false`.

See [Deployment Guide](docs/operations/DEPLOYMENT.md) for full operational details.

## Documentation Index

| Document                                              | Description                                         |
| ----------------------------------------------------- | --------------------------------------------------- |
| [CLAUDE.md](CLAUDE.md)                                | Agent entrypoint and reading order                  |
| [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md)  | System architecture overview                        |
| [Frontend Surface](docs/architecture/FRONTEND.md)     | Routes, boundaries, UI contracts                    |
| [Judge Pipeline](docs/architecture/JUDGE_PIPELINE.md) | Pipeline stages, sandbox execution                  |
| [Database Schema](docs/architecture/DATABASE.md)      | Models, relationships, enums                        |
| [Redis Architecture](docs/architecture/REDIS.md)      | Key schema, pub/sub, scoreboard                     |
| [Security](docs/operations/SECURITY.md)               | Auth, trust boundaries, sandbox isolation           |
| [Reliability](docs/operations/RELIABILITY.md)         | Invariants, failure modes, operational expectations |
| [Deployment](docs/operations/DEPLOYMENT.md)           | Docker Compose, CI/CD rollout, microservice modes   |
| [Getting Started](docs/runbooks/getting-started.md)   | Bootstrap procedures for new developers             |

## Design Documents

- [Judge Pipeline Extensibility Spec](docs/plans/SPEC.md)
- [Temporal Migration Design](docs/plans/2026-04-02-temporal-migration-design.md)
- [Page Lock & IP Lock Design](docs/plans/2026-03-20-page-lock-ip-lock-design.md)
- [CP Problem Judge Mapping](docs/plans/2026-04-01-cp-problem-judge-mapping.md)
