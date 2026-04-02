# NOJV

Production-oriented Online Judge platform. Supports competitive programming contests (ICPC/IOI), course assessments, practice submissions, and plagiarism detection.

## What Ships Today

- **8 languages**: C, C++, Go, Java, JavaScript, Python, Rust, TypeScript
- **3 judge types**: Standard (diff), Checker (custom script), Interactive (bidirectional I/O)
- **Extensible pipeline**: Static analysis, custom scoring, artifact collection, network access
- **Contests**: ICPC/IOI scoring, real-time scoreboard, freeze, IP lock, page lock
- **Courses**: Membership management, join tokens, assessments with deadlines
- **Plagiarism detection**: Stanford MOSS integration
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

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full architecture overview.

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

infra/
  docker/           Dockerfiles (web, worker, sandbox, migrator)
  gcp/              Cloud Build, Cloud Run, GKE deployment
  k8s/sandbox/      Kubernetes namespace, network policy, resource quota

tests/              Vitest + Playwright test suites
docs/               Design documents, runbooks, specifications
```

## Key Technologies

- **Frontend**: SvelteKit, Vite, Tailwind CSS 4, Bits UI, Monaco Editor
- **Auth**: better-auth (email/password, GitHub, Google)
- **Orchestration**: Temporal (TypeScript SDK)
- **Database**: PostgreSQL 17, Prisma 7
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

# 3. Start infrastructure (Postgres, Redis, Temporal, Temporal UI)
docker compose up -d

# 4. Build packages and prepare database
pnpm db:generate
pnpm build
pnpm db:push
pnpm db:seed:validate
pnpm db:seed

# 5. Build sandbox image (needed for submission judging)
pnpm sandbox:build

# 6. Start dev servers
pnpm dev
```

See [Getting Started Runbook](docs/runbooks/getting-started.md) for detailed bootstrap procedures.

### Local Ports

| Service     | URL                   |
| ----------- | --------------------- |
| Web         | http://localhost:5173 |
| PostgreSQL  | localhost:5432        |
| Redis       | localhost:6379        |
| Temporal    | localhost:7233        |
| Temporal UI | http://localhost:8080 |

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
pnpm -C apps/sandbox-runner test
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

## GCP Deployment

| Component | Service               |
| --------- | --------------------- |
| web       | Cloud Run             |
| migrator  | Cloud Run Job         |
| worker    | GKE deployment (KEDA) |
| sandbox   | Kubernetes Jobs       |
| postgres  | Cloud SQL             |
| redis     | Memorystore           |
| images    | Artifact Registry     |
| secrets   | Secret Manager        |

```bash
gcloud builds submit --config infra/gcp/cloudbuild.yaml \
  --substitutions _REGION=asia-east1,_REPOSITORY=nojv,_IMAGE_TAG=release-20260312
```

See [Deployment Guide](docs/DEPLOYMENT.md) for details.

## Documentation Index

| Document                                            | Description                                         |
| --------------------------------------------------- | --------------------------------------------------- |
| [CLAUDE.md](CLAUDE.md)                              | Agent entrypoint and reading order                  |
| [ARCHITECTURE.md](ARCHITECTURE.md)                  | System architecture overview                        |
| [Frontend Surface](docs/FRONTEND.md)                | Routes, boundaries, UI contracts                    |
| [Temporal Workflows](docs/TEMPORAL.md)              | Workflows, activities, task queues                  |
| [Judge Pipeline](docs/JUDGE_PIPELINE.md)            | Pipeline stages, sandbox execution                  |
| [Database Schema](docs/DATABASE.md)                 | Models, relationships, enums                        |
| [Redis Architecture](docs/REDIS.md)                 | Key schema, pub/sub, scoreboard                     |
| [Security](docs/SECURITY.md)                        | Auth, trust boundaries, sandbox isolation           |
| [Reliability](docs/RELIABILITY.md)                  | Invariants, failure modes, operational expectations |
| [Deployment](docs/DEPLOYMENT.md)                    | Docker Compose, GCP, microservice modes             |
| [Getting Started](docs/runbooks/getting-started.md) | Bootstrap procedures for new developers             |

## Design Documents

- [Judge Pipeline Extensibility Spec](docs/plans/SPEC.md)
- [Temporal Migration Design](docs/plans/2026-04-02-temporal-migration-design.md)
- [Page Lock & IP Lock Design](docs/plans/2026-03-20-page-lock-ip-lock-design.md)
- [CP Problem Judge Mapping](docs/plans/2026-04-01-cp-problem-judge-mapping.md)
