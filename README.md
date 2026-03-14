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

# Copy env template
cp .env.example .env
# Edit .env with your DATABASE_URL, Redis, Better Auth, OAuth, Resend secrets

# Start infra (postgres + redis; web/worker run on host via pnpm dev)
docker compose up -d

# Build packages and push schema to DB
pnpm db:generate
pnpm build
pnpm db:push
pnpm db:seed    # optional — seeds demo users, problems, contests, courses
pnpm sandbox:build  # optional — only needed for submission judging

pnpm dev
```

### Environment Files

| File   | Purpose                                                      |
| ------ | ------------------------------------------------------------ |
| `.env` | Database, Redis, Better Auth, OAuth, Resend, sandbox, worker |

### Local Ports

| Service    | URL                     |
| ---------- | ----------------------- |
| Web        | `http://localhost:5173` |
| PostgreSQL | `localhost:5432`        |
| Redis      | `localhost:6379`        |

## Developer Workflow

```bash
pnpm install
docker compose up -d
pnpm db:generate
pnpm build
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
# Via Cloud Build
gcloud builds submit --config infra/gcp/cloudbuild.yaml \
  --substitutions _REGION=asia-east1,_REPOSITORY=nojv,_IMAGE_TAG=release-20260312

# Or via convenience script (needs PROJECT_ID, DATABASE_URL, REDIS_URL)
pnpm deploy:gcp
```

## Plans

- [`docs/plans/2026-03-13-platform-expansion-design.md`](docs/plans/2026-03-13-platform-expansion-design.md)
- [`docs/plans/2026-03-14-merge-contest-exam-language-restrictions.md`](docs/plans/2026-03-14-merge-contest-exam-language-restrictions.md)
