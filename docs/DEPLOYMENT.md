# Deployment Guide

## Local Development (Docker Compose)

### Services

| Service       | Image                          | Port | Purpose                          |
| ------------- | ------------------------------ | ---- | -------------------------------- |
| postgres      | postgres:17-alpine             | 5432 | Database (app + Temporal)        |
| redis         | redis:8-alpine                 | 6379 | Cache, pub/sub, scoreboard       |
| temporal      | temporalio/auto-setup:latest   | 7233 | Workflow engine                  |
| temporal-ui   | temporalio/ui:latest           | 8080 | Workflow monitoring              |
| web           | Custom (prod profile)          | 3000 | SvelteKit production build       |
| worker        | Custom (prod profile)          | 8080 | Temporal worker                  |
| sandbox-image | Custom (sandbox-build profile) | —    | Build-only: sandbox Docker image |

### Quick Start

```bash
# Infrastructure only (for local dev with pnpm dev)
docker compose up -d

# Full production stack
docker compose --profile prod up -d

# Build sandbox image
docker compose --profile sandbox-build up sandbox-image
```

### Temporal Auto-Setup

The `temporalio/auto-setup` image automatically:

- Creates the Temporal database schema in PostgreSQL
- Configures the `default` namespace
- Starts the Temporal server

It shares the same PostgreSQL instance as the application (separate schema).

## Environment Variables

### Required

| Variable             | Default                                              | Purpose                                       |
| -------------------- | ---------------------------------------------------- | --------------------------------------------- |
| `DATABASE_URL`       | `postgresql://postgres:postgres@localhost:5432/nojv` | PostgreSQL connection                         |
| `REDIS_URL`          | `redis://localhost:6379`                             | Redis connection                              |
| `BETTER_AUTH_SECRET` | —                                                    | Session encryption key (change in production) |
| `BETTER_AUTH_URL`    | `http://localhost:5173`                              | Frontend URL for OAuth redirects              |

### OAuth (Optional)

| Variable               | Purpose                    |
| ---------------------- | -------------------------- |
| `GITHUB_CLIENT_ID`     | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app secret    |
| `GOOGLE_CLIENT_ID`     | Google OAuth client ID     |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |

### Email (Optional)

| Variable            | Purpose                      |
| ------------------- | ---------------------------- |
| `RESEND_API_KEY`    | Resend email service API key |
| `EMAIL_FROM_DOMAIN` | Sender domain for emails     |

### Temporal

| Variable             | Default          | Purpose                 |
| -------------------- | ---------------- | ----------------------- |
| `TEMPORAL_ADDRESS`   | `localhost:7233` | Temporal Server address |
| `TEMPORAL_NAMESPACE` | `default`        | Temporal namespace      |

### Worker

| Variable             | Default              | Purpose                                             |
| -------------------- | -------------------- | --------------------------------------------------- |
| `EXECUTION_BACKEND`  | `docker`             | Sandbox executor: `docker` or `kubernetes`          |
| `SANDBOX_IMAGE`      | `nojv-sandbox:local` | Sandbox container image                             |
| `SANDBOX_CPU_LIMIT`  | `1`                  | CPU limit per sandbox                               |
| `SANDBOX_MEMORY_MB`  | `256`                | Memory limit per sandbox (MB)                       |
| `SANDBOX_PIDS_LIMIT` | `64`                 | PID limit per sandbox                               |
| `PORT`               | `8082`               | Health server port (avoid 8080 used by Temporal UI) |
| `WORKER_CONCURRENCY` | `4`                  | Activity concurrency per task queue                 |
| `WORKER_MODE`        | `all`                | Task queues: `all`, `judge`, `platform`             |

### Kubernetes (Production Only)

| Variable             | Purpose                               |
| -------------------- | ------------------------------------- |
| `K8S_NAMESPACE`      | Kubernetes namespace for sandbox jobs |
| `K8S_CPU_REQUEST`    | CPU request per sandbox pod           |
| `K8S_CPU_LIMIT`      | CPU limit per sandbox pod             |
| `K8S_MEMORY_REQUEST` | Memory request per sandbox pod        |
| `K8S_MEMORY_LIMIT`   | Memory limit per sandbox pod          |

## GCP Production Architecture

```
                    ┌──────────────────┐
                    │   Cloud Build    │
                    │  (CI/CD trigger) │
                    └────────┬─────────┘
                             │ builds
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
     ┌────────────┐  ┌────────────┐  ┌───────────┐
     │ Cloud Run  │  │    GKE     │  │ Cloud Run │
     │   (web)    │  │  (worker)  │  │   Job     │
     │            │  │            │  │ (migrator)│
     └─────┬──────┘  └─────┬──────┘  └───────────┘
           │               │
           ├───► Cloud SQL (PostgreSQL)
           ├───► Memorystore (Redis)
           └───► Temporal Server
                      │
                 GKE (worker) ───► K8s Jobs (sandbox)
```

### Service Mapping

| Component | GCP Service         | Scaling                     |
| --------- | ------------------- | --------------------------- |
| web       | Cloud Run           | Automatic (request-based)   |
| worker    | GKE Deployment      | KEDA (Temporal queue depth) |
| migrator  | Cloud Run Job       | One-shot per deployment     |
| sandbox   | GKE Kubernetes Jobs | Per-submission              |
| postgres  | Cloud SQL           | Vertical (manual)           |
| redis     | Memorystore         | Vertical (manual)           |
| temporal  | GKE Deployment      | Manual                      |
| images    | Artifact Registry   | —                           |
| secrets   | Secret Manager      | —                           |

### Deployment Command

```bash
# Build and push images via Cloud Build (manual, optional)
gcloud builds submit --config infra/gcp/cloudbuild.yaml \
  --substitutions _REGION=asia-east1,_REPOSITORY=nojv,_IMAGE_TAG=release-20260312
```

### Dockerfiles

| Dockerfile                               | Purpose                    |
| ---------------------------------------- | -------------------------- |
| `infra/docker/web.Dockerfile`            | SvelteKit production build |
| `infra/docker/worker.Dockerfile`         | Temporal worker            |
| `infra/docker/sandbox-runner.Dockerfile` | Sandbox execution runtime  |
| `infra/docker/migrator.Dockerfile`       | Database migration runner  |

## Microservice Deployment

The worker supports three deployment modes via `WORKER_MODE`:

### Mode: all (Development)

Single process runs both task queues. Suitable for local development and small deployments.

```yaml
environment:
  WORKER_MODE: all
```

### Mode: judge (Sandbox Workers)

Only runs judge-queue activities (sandbox execution). Scale based on submission volume.

```yaml
environment:
  WORKER_MODE: judge
  EXECUTION_BACKEND: kubernetes
```

Requires access to Docker daemon or Kubernetes API for sandbox execution.

### Mode: platform (Lifecycle Workers)

Only runs platform-queue activities (contest/assessment lifecycle, plagiarism, notifications). Lightweight — no sandbox access needed.

```yaml
environment:
  WORKER_MODE: platform
```

### Scaling Strategy

```
Submission load ──► Scale judge workers (KEDA on Temporal queue depth)
Contest count   ──► Platform workers handle lifecycle (low overhead)
                    Typically 1-2 platform workers suffice
```

## Database Migrations

```bash
# Development: push schema directly
pnpm db:push

# Production: create and apply migrations
pnpm db:migrate

# Validate schema
pnpm db:validate
```

In production, migrations run in the deployment workflow before new `web`/`worker` containers are rolled out.

## CI Pipeline

Workflow: `.github/workflows/ci.yml`

```bash
pnpm ci:verify
```

Steps:

1. `pnpm format` — Prettier formatting check
2. `pnpm db:generate` — Regenerate Prisma client
3. `turbo run build lint test` — Build, lint, and test all packages

Additional validations:

- Prisma schema validation (`pnpm db:validate`)
- Docker Compose config validation

## GitHub CD Strategy (Single Path)

There is one deployment workflow only:

- Workflow: `.github/workflows/deploy.yml`
- Trigger: CI workflow success (`workflow_run`) for pushes to `main`
- Target: self-hosted Linux runner on your remote server
- Source code: exact commit SHA that passed CI (`workflow_run.head_sha`)
- Runtime: Docker Compose profiles (`sandbox-build`, `deploy`, `prod`)

### Required runner setup

The self-hosted runner must have:

1. Docker Engine and Docker Compose
2. Persistent workspace checkout permissions for the repository
3. Network access for dependencies used during Docker image build
4. Enough disk space for image builds and local cache

### Required Environment On Runner

1. `BETTER_AUTH_SECRET`
2. `BETTER_AUTH_URL`

Optional OAuth environment variables:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

### Deployment steps executed by workflow

1. Checkout the exact commit SHA that passed CI
2. Start/verify infra services (`postgres`, `redis`, `temporal`, `temporal-ui`)
3. Build runtime images (`sandbox-image`, `migrator`, `web`, `worker`)
4. Run database migrations using `migrator`
5. Roll out `web` and `worker` with `--wait --remove-orphans`
6. Verify web reachability and container health status
7. Dump diagnostics automatically if any step fails

## Rollback Procedure (Remote Docker Compose)

Rollback is commit-based. Re-run deployment for an older known-good commit SHA.

1. In GitHub Actions, open `CI` run for the target commit on `main`
2. Re-run `CD Deploy To Remote Server` using that commit SHA context
3. Confirm `docker compose --profile prod ps` shows healthy `web` and `worker`
4. Validate key flows and monitor logs for at least 15 minutes

### Database Rollback

Prisma does not auto-generate down migrations. If a migration causes issues:

1. Identify the breaking migration in `packages/db/prisma/migrations/`
2. Write manual rollback SQL and apply it on the production database
3. Mark migration state correctly in `_prisma_migrations` when needed
4. Deploy the previous application commit compatible with the restored schema

### Pre-Rollback Checklist

1. Confirm issue is deployment-related, not upstream infrastructure instability
2. Check web and worker health endpoints
3. Check Temporal workflows for stuck executions
4. Verify web and worker versions are schema-compatible before rollback
5. After rollback, monitor logs, queue drain behavior, and health checks

## Related Docs

- [Architecture Overview](../ARCHITECTURE.md)
- [Temporal Workflows](TEMPORAL.md)
- [Getting Started Runbook](runbooks/getting-started.md)
