# NOJV

Production-oriented Online Judge platform monorepo.

## Architecture

```
apps/
  web/              SvelteKit frontend — problem browsing, editor, contests, courses, submissions
  worker/           BullMQ worker — submission judging, sandbox orchestration
  sandbox-runner/   Isolated container runtime for code execution

packages/
  core/             Shared Zod schemas, types, and utilities
  db/               Prisma 7 schema, migrations, database client, and seed script
  queue/            BullMQ job factories and queue name contracts
  sandbox/          Sandbox execution runtime library

tooling/
  eslint/           Shared ESLint 9 flat config
  prettier/         Shared Prettier config
  typescript/       Shared TypeScript config

infra/
  docker/           Dockerfiles for web, worker, sandbox-runner, migrator
  gcp/              Cloud Build, Cloud Run, GKE deployment assets
  k8s/sandbox/      Kubernetes namespace, network policy, resource quota
```

### Key Technologies

- **Frontend**: SvelteKit, Vite, Tailwind CSS 4, Bits UI, Monaco editor
- **Auth**: better-auth
- **Backend**: BullMQ, Express (worker admin), Prisma 7, PostgreSQL
- **Validation**: Zod 4
- **Testing**: Vitest, Playwright
- **Build**: Turborepo, pnpm workspaces, tsdown, esbuild

## Local Setup

```bash
pnpm install

# Copy env templates
cp packages/db/.env.example packages/db/.env
cp apps/worker/.env.example apps/worker/.env
# Create apps/web/.env with DATABASE_URL, Redis, Better Auth, OAuth, Resend secrets

# Start infra and build
docker compose up -d postgres redis
pnpm sandbox:build
pnpm db:generate
pnpm db:deploy
pnpm db:seed    # optional — seeds demo users, problems, contests, courses

pnpm dev
```

### Environment Files

| File               | Purpose                                       |
| ------------------ | --------------------------------------------- |
| `packages/db/.env` | `DATABASE_URL` for Prisma migrations and seed |
| `apps/web/.env`    | Database, Redis, Better Auth, OAuth, Resend   |
| `apps/worker/.env` | Redis, sandbox execution settings             |

### Local Ports

| Service    | URL                    |
| ---------- | ---------------------- |
| Web        | `http://localhost:3000` |
| PostgreSQL | `localhost:5432`       |
| Redis      | `localhost:6379`       |

## Developer Workflow

```bash
pnpm install
docker compose up -d postgres redis
pnpm sandbox:build
pnpm db:generate
pnpm dev

# Before pushing
pnpm ci:verify
```

Individual checks:

```bash
pnpm format        # prettier check
pnpm format:write  # prettier fix
pnpm lint
pnpm test
pnpm build
pnpm typecheck
pnpm db:validate
```

## Sandbox Runtime

Submissions execute inside an isolated sandbox container.

- Dockerfile: `infra/docker/sandbox-runner.Dockerfile`
- Image tag: `nojv-sandbox:local`
- Default limits: 1 CPU, 256 MB, 64 pids, `network=none`
- Hardening: `cap-drop ALL`, `no-new-privileges`, `read-only rootfs`, `tmpfs /tmp`

Build:

```bash
pnpm sandbox:build
# or
docker compose build sandbox-image
```

The worker selects its executor via `EXECUTION_BACKEND` (`docker` locally, `kubernetes` in production).

## CI

- Workflow: `.github/workflows/ci.yml`
- Command: `pnpm ci:verify`
- Checks: formatting, lint, tests, builds, Prisma schema validation, Docker Compose config validation

## GCP Deployment

| Component  | Service                  |
| ---------- | ------------------------ |
| web        | Cloud Run                |
| migrator   | Cloud Run Job            |
| worker     | GKE deployment (KEDA)   |
| sandbox    | Kubernetes Jobs          |
| postgres   | Cloud SQL                |
| redis      | Memorystore              |
| images     | Artifact Registry        |
| secrets    | Secret Manager           |

```bash
# Via Cloud Build
gcloud builds submit --config infra/gcp/cloudbuild.yaml \
  --substitutions _REGION=asia-east1,_REPOSITORY=nojv,_IMAGE_TAG=release-20260312

# Or via convenience script (needs PROJECT_ID, DATABASE_URL, REDIS_URL)
pnpm deploy:gcp
```

## Plans

- [`docs/plans/2026-03-12-architecture-design.md`](docs/plans/2026-03-12-architecture-design.md)
- [`docs/plans/2026-03-12-architecture-refactor-plan.md`](docs/plans/2026-03-12-architecture-refactor-plan.md)
