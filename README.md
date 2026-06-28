# NOJV

Production-oriented Online Judge platform. Supports competitive programming contests (ICPC/IOI), course assessments, practice submissions, and plagiarism detection.

## What Ships Today

- **8 languages**: C, C++, Go, Java, JavaScript, Python, Rust, TypeScript
- **3 standard judge types**: Standard (diff), Checker (DOMjudge validator), Interactive (DOMjudge interactor)
- **Advanced Mode escape hatch**: TA-provided Docker image owns grading for problems Standard Mode can't express (network-isolated, read-only rootfs; no static-analysis / artifact-collection / network-access stages — the pipeline is fixed)
- **Contests**: ICPC/IOI scoring, real-time scoreboard, freeze, IP lock, page lock
- **Courses**: Teacher-driven membership management (no self-serve join token), assessments with deadlines
- **Plagiarism detection**: Dolos AST similarity (self-hosted, in-process)
- **Auth**: GitHub OAuth + Google OAuth for general users; password sign-in reserved for the seeded admin account (no public email/password registration)
- **i18n**: English + Traditional Chinese (zh-TW)
- **Real-time**: SSE streaming for submission verdicts and contest events
- **Orchestration**: Temporal workflows with durable timers and queries

## Architecture at a Glance

```
Browser ──→ SvelteKit (web) ──→ Temporal Server ──→ Worker ──→ Sandbox
                │                                      │
                ├── PostgreSQL (source of truth)        │
                └── Redis (pub/sub)                    │
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
  application/      Business logic — queries, mutations, scoring, stats (@nojv/application)
  redis/            Redis connection, key registry, pub/sub
  storage/          S3-compatible object storage (problem images)
  temporal/         Temporal client + dispatch API + task queue constants + types (workflows/activities live in apps/worker)

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
```

## Key Technologies

- **Frontend**: SvelteKit, Vite, Tailwind CSS 4, Bits UI, Monaco Editor
- **Auth**: better-auth (email/password, GitHub, Google)
- **Orchestration**: Temporal (TypeScript SDK)
- **Database**: PostgreSQL 18, Prisma 7
- **Cache**: Redis 8 (pub/sub, rate limiting, cooldown, hot cache)
- **Validation**: Zod 4
- **Testing**: Vitest, Playwright
- **Build**: Turborepo, pnpm workspaces, tsdown, esbuild

## Prerequisites

- Node.js >= 24.0.0
- pnpm 10.x
- Docker Desktop (for local Postgres, Redis, Temporal, and sandbox)

## Local Development (Docker Compose)

Docker Compose is the **local development** path only — it is not a deployment
method. It starts the backing services (Postgres, Redis, MinIO, Temporal,
Temporal UI) as containers so you can run the app from source with `pnpm dev`.
For deploying NOJV to a real environment, use the Helm chart (see
[Deployment](#deployment)).

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env template
cp .env.example .env

# 3. Start local infrastructure (Postgres, Redis, MinIO, Temporal, Temporal UI)
docker compose up -d

# 4. Build packages and prepare database
pnpm db:generate
pnpm build
pnpm db:push     # push the Prisma schema to the local DB
pnpm db:seed     # load demo users / problems / contests

# 5. Build sandbox image (needed for submission judging)
pnpm sandbox:build

# 6. Start dev servers, then open http://localhost:5173
pnpm dev
```

Each Compose service maps to one local dependency:

| Compose service | Local dependency                              | Reached at            |
| --------------- | --------------------------------------------- | --------------------- |
| `postgres`      | App + Temporal database (PostgreSQL 18)       | `localhost:5432`      |
| `redis`         | Cache / pub-sub / scoreboard (Redis 8)        | `localhost:6379`      |
| `minio`         | S3-compatible object storage (problem assets) | `localhost:9000/9001` |
| `temporal`      | Workflow engine (`temporalio/auto-setup`)     | `localhost:7233`      |
| `temporal-ui`   | Temporal Web UI                               | `localhost:8080`      |

The app itself (web on `localhost:5173`, worker) runs from source via `pnpm dev`
— not as a Compose service. See the
[Getting Started Runbook](docs/runbooks/getting-started.md) for detailed
bootstrap procedures.

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
- Checks: formatting, lint, tests, builds, Prisma schema validation

## Deployment

NOJV deploys to **both** single-machine Kubernetes (k3s / kind on one node)
and **GKE** through the **same Helm umbrella chart** at `infra/charts/nojv`.
Container images are built by Cloud Build (`infra/gcp/cloud-build`); the chart
provisions web, the Temporal workers, the sandbox namespace policy, the
migrator hook, and (optionally) in-cluster Postgres (CloudNativePG), Redis, and
MinIO.

```bash
# Single-machine (k3s / kind, one node)
helm upgrade --install nojv infra/charts/nojv \
  -f infra/charts/nojv/values-single-machine.yaml -n nojv --create-namespace

# GKE (HA on a Dataplane-V2 cluster)
helm upgrade --install nojv infra/charts/nojv \
  -f infra/charts/nojv/values-gke.yaml -n nojv --create-namespace
```

Two one-time prerequisites are installed out-of-band (the chart does not vendor
them): the **CloudNativePG operator** (provides the Postgres `Cluster` +
`ScheduledBackup` the chart renders) and the **Temporal Server** (the official
`temporalio/temporal` Helm chart). In production, **web runs in the cluster**
behind **Cloudflare** (DNS / TLS / CDN at the edge) — there is no Cloud Run.

See [Deployment Guide](docs/operations/DEPLOYMENT.md) for the full procedure,
the CNPG backup posture, and the Temporal prerequisite options.

## Documentation Index

| Document                                              | Description                                           |
| ----------------------------------------------------- | ----------------------------------------------------- |
| [CLAUDE.md](CLAUDE.md)                                | Agent entrypoint and reading order                    |
| [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md)  | System architecture overview                          |
| [Frontend Surface](docs/architecture/FRONTEND.md)     | Routes, boundaries, UI contracts                      |
| [Judge Pipeline](docs/architecture/JUDGE_PIPELINE.md) | Pipeline stages, sandbox execution                    |
| [Database Schema](docs/architecture/DATABASE.md)      | Models, relationships, enums                          |
| [Redis Architecture](docs/architecture/REDIS.md)      | Key schema, pub/sub                                   |
| [Security](docs/operations/SECURITY.md)               | Auth, trust boundaries, sandbox isolation             |
| [Reliability](docs/operations/RELIABILITY.md)         | Invariants, failure modes, operational expectations   |
| [Deployment](docs/operations/DEPLOYMENT.md)           | Helm chart deploy (single-machine k8s + GKE), backups |
| [Getting Started](docs/runbooks/getting-started.md)   | Bootstrap procedures for new developers               |

## Design Documents

- [Judge Pipeline Extensibility Spec](docs/plans/completed/2026-04-02-judge-pipeline-spec.md)
- [Temporal Migration Design](docs/plans/completed/2026-04-02-temporal-migration-design.md)
- [Page Lock & IP Lock Design](docs/plans/completed/2026-03-20-page-lock-ip-lock-design.md)
- [CP Problem Judge Mapping](docs/plans/completed/2026-04-01-cp-problem-judge-mapping.md)
