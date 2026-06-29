<h1 align="center">NOJV</h1>

<p align="center">
  An open-source online judge for competitive programming and CS courses —
  contests, course assessments, practice, and plagiarism detection.
</p>

<p align="center">
  <a href="https://github.com/TakalaWang/NOJV/actions/workflows/ci.yml"><img src="https://github.com/TakalaWang/NOJV/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-brightgreen" alt="Node >= 24">
  <img src="https://img.shields.io/badge/SvelteKit-%2BTemporal-ff3e00" alt="SvelteKit + Temporal">
</p>

> Self-hostable, sandboxed, and built for real contests and classrooms:
> ICPC/IOI scoring, DOMjudge-aligned validators, Temporal-orchestrated judging,
> real-time scoreboards, and AST-based plagiarism detection.

## Features

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

## Tech Stack

- **Frontend**: SvelteKit, Vite, Tailwind CSS 4, Bits UI, Monaco Editor
- **Auth**: better-auth (GitHub + Google OAuth; admin password sign-in)
- **Orchestration**: Temporal (TypeScript SDK)
- **Database**: PostgreSQL 18, Prisma 7
- **Cache**: Redis 8 (pub/sub, rate limiting, cooldown, hot cache)
- **Validation**: Zod 4
- **Testing**: Vitest, Playwright
- **Build**: Turborepo, pnpm workspaces, tsdown, esbuild

## Quick Start

**Prerequisites:** Node.js >= 24, pnpm 10.x, Docker Desktop (local Postgres, Redis, Temporal, sandbox).

Docker Compose is the **local development** path only — it starts the backing
services so you can run the app from source with `pnpm dev`. To deploy NOJV, use
the Helm chart (see [Deployment](#deployment)).

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

See [Deployment Guide](docs/operations/DEPLOYMENT.md) for the full procedure,
the CNPG backup posture, and the Temporal prerequisite options.

## Documentation

| Document                                              | Description                                           |
| ----------------------------------------------------- | ----------------------------------------------------- |
| [CLAUDE.md](CLAUDE.md)                                | Agent entrypoint, reading order, repository layout    |
| [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md)  | System architecture overview                          |
| [Frontend Surface](docs/architecture/FRONTEND.md)     | Routes, boundaries, UI contracts                      |
| [Judge Pipeline](docs/architecture/JUDGE_PIPELINE.md) | Pipeline stages, sandbox execution                    |
| [Database Schema](docs/architecture/DATABASE.md)      | Models, relationships, enums                          |
| [Redis Architecture](docs/architecture/REDIS.md)      | Key schema, pub/sub                                   |
| [Security](docs/operations/SECURITY.md)               | Auth, trust boundaries, sandbox isolation             |
| [Reliability](docs/operations/RELIABILITY.md)         | Invariants, failure modes, operational expectations   |
| [Deployment](docs/operations/DEPLOYMENT.md)           | Helm chart deploy (single-machine k8s + GKE), backups |
| [Getting Started](docs/runbooks/getting-started.md)   | Bootstrap procedures for new developers               |

## Contributing

Contributions are welcome. Before opening a PR:

1. Read [CLAUDE.md](CLAUDE.md) for the architecture entrypoint and reading order.
2. Follow the [Getting Started Runbook](docs/runbooks/getting-started.md) to bring up a local stack.
3. Run `pnpm ci:verify` (formatting, lint, tests, builds, schema validation) before pushing.

Keep changes surgical and the [living docs](docs/) aligned with landed code.

## License

[MIT](LICENSE) © 2026 Takala Wang
