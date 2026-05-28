# Getting Started

Step-by-step bootstrap procedures for new developers.

## Prerequisites

Verify before starting:

```bash
node -v   # >= 24.0.0
pnpm -v   # 10.x
docker -v # Docker Desktop running
```

## 1. Clone and Install

```bash
git clone <repo-url>
cd NOJV
pnpm install
```

## 2. Environment Setup

```bash
cp .env.example .env
```

Edit `.env` with your values. For local development the defaults work out of the box — the `S3_*` vars already match the local MinIO that docker-compose starts, and OAuth is optional:

| Variable                  | Action                                                                      |
| ------------------------- | --------------------------------------------------------------------------- |
| `DATABASE_URL`            | Keep default for local PostgreSQL                                           |
| `REDIS_URL`               | Keep default for local Redis                                                |
| `BETTER_AUTH_SECRET`      | Change to a random string in production                                     |
| `S3_ENDPOINT`             | Local MinIO: `http://localhost:9000`                                        |
| `S3_ACCESS_KEY`           | Local MinIO: `minioadmin`                                                   |
| `S3_SECRET_KEY`           | Local MinIO: `minioadmin`                                                   |
| `EXECUTION_BACKEND`       | `docker` for local sandbox execution (`kubernetes` in production)           |
| `ALLOWED_HOSTS`           | Comma-separated Vite host allowlist; default `localhost,127.0.0.1,...`      |
| `METRICS_TOKEN`           | Random secret protecting the web `/metrics` endpoint                        |
| `BODY_SIZE_LIMIT`         | 64 MiB upload cap for adapter-node (prod profile only; Vite dev ignores it) |
| `GITHUB_CLIENT_ID/SECRET` | Optional: create a GitHub OAuth App                                         |
| `GOOGLE_CLIENT_ID/SECRET` | Optional: create a Google OAuth App                                         |
| `RESEND_API_KEY`          | Optional: needed for email verification                                     |

> **Note:** Local storage is MinIO; `.env.example` ships the matching defaults (`S3_ENDPOINT=http://localhost:9000`, `S3_ACCESS_KEY`/`S3_SECRET_KEY=minioadmin`, `S3_BUCKET=nojv`). The storage client (`packages/storage/src/client.ts`) throws on boot if `S3_ENDPOINT`/`S3_ACCESS_KEY`/`S3_SECRET_KEY` are unset, so keep them set.

## 3. Start Infrastructure

```bash
docker compose up -d
```

This starts:

- PostgreSQL 18 on port 5432
- Redis 8 on port 6379
- MinIO (S3-compatible storage) on port 9000 (API) and 9001 (console)
- Temporal Server on port 7233
- Temporal UI on port 8080

The `minio-init` container automatically creates the `nojv` bucket. No manual bootstrap needed.

Wait for health checks to pass:

```bash
docker compose ps  # All services should show "healthy"
```

## 4. Prepare Database

```bash
# Generate Prisma client
pnpm db:generate

# Build all packages (required before DB operations)
pnpm build

# Push schema to database
pnpm db:push

# Validate seed data
pnpm db:seed:validate

# Seed development data
pnpm db:seed
```

Seed creates:

- 5 users — 4 with password `password123` (admin, teacher, ta-student, student); the 5th (`b11902999`) is an OAuth-placeholder with no password
- 12 problems with testcases
- 3 contests
- 1 course ("Operating Systems Lab") with memberships and assessments (students are added directly by the teacher — the join-token flow was removed)

## 5. Build Sandbox Image

```bash
pnpm sandbox:build
```

This builds the `nojv-sandbox:local` Docker image used for executing student code.

## 6. Start Development Servers

```bash
pnpm dev
```

This starts:

- **Web**: http://localhost:5173 (SvelteKit dev server with HMR)
- **Worker**: Temporal worker with both task queues

## 7. Verify Setup

1. Open http://localhost:5173 — should see the landing page
2. Open http://localhost:8080 — Temporal UI should show the `default` namespace
3. Sign in with a seeded user (check seed data for email/password)
4. Navigate to a problem, write code, and submit — should see the judge process in Temporal UI

## Common Tasks

### Reset Database

```bash
pnpm db:push --force-reset  # Drops and recreates all tables
pnpm db:seed                # Re-seed development data
```

### Rebuild After Schema Change

```bash
pnpm db:generate  # Regenerate Prisma client
pnpm build        # Rebuild all packages
pnpm db:push      # Apply schema changes
```

### Run Tests

```bash
pnpm test:unit          # Fast unit tests
pnpm test:integration   # Integration tests (needs running DB)
pnpm test:e2e           # E2E tests (needs running app)
pnpm test:all           # All of the above
```

### Full CI Check Locally

```bash
pnpm ci:verify
```

Runs: formatting check, the `lint:domain-queries` guard, Prisma generation, build, typecheck, lint, and unit tests.

### Rebuild Sandbox Image

After changing `apps/sandbox-runner` or `infra/docker/sandbox-runner.Dockerfile`:

```bash
pnpm sandbox:build
```

## Troubleshooting

### "vitest not found" or "tsc not found"

```bash
pnpm install  # Reinstall dependencies
```

### Prisma client errors

```bash
pnpm db:generate  # Regenerate the client
pnpm build        # Rebuild packages
```

### Temporal connection refused

```bash
docker compose ps  # Check if temporal service is healthy
docker compose logs temporal  # Check for errors
```

Temporal may take 30+ seconds to start (it runs database migrations on first boot).

### Docker socket permission denied (worker)

The worker needs access to the Docker socket for local sandbox execution:

```bash
# macOS: Docker Desktop handles this automatically
# Linux: Add your user to the docker group
sudo usermod -aG docker $USER
```

### Port conflicts

If ports 9000, 9001, 5432, 6379, 7233, or 8080 are in use:

```bash
# Check what's using the port
lsof -i :5432

# Or modify docker-compose.yml port mappings
```

### Testing IP-based proctoring locally

Production resolves the client IP from Cloudflare's `CF-Connecting-IP` header (see [SECURITY.md — Client IP Trust Model](../operations/SECURITY.md#client-ip-trust-model-cloudflare-only)). Locally (`NODE_ENV !== "production"`) `getClientIp(event)` reads an `x-dev-ip` request header first, then falls back to the socket address.

To exercise exam / contest IP whitelist or binding in dev:

```bash
# Pretend the request came from 10.1.2.3 (outside a campus whitelist, for example)
curl -H "x-dev-ip: 10.1.2.3" http://localhost:5173/exams/<examId>

# Pretend to be an allowed campus IP
curl -H "x-dev-ip: 140.112.30.20" http://localhost:5173/exams/<examId>
```

The override only fires when `NODE_ENV !== "production"`. Production ignores `x-dev-ip` entirely and requires `CF-Connecting-IP`.

## Related Docs

- [Architecture Overview](../architecture/ARCHITECTURE.md)
- [Deployment Guide](../operations/DEPLOYMENT.md)
- [Frontend Surface](../architecture/FRONTEND.md)
