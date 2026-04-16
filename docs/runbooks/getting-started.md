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

Edit `.env` with your values. For local development, the defaults work out of the box except for OAuth (optional):

| Variable                  | Action                                  |
| ------------------------- | --------------------------------------- |
| `DATABASE_URL`            | Keep default for local PostgreSQL       |
| `REDIS_URL`               | Keep default for local Redis            |
| `BETTER_AUTH_SECRET`      | Change to a random string in production |
| `GITHUB_CLIENT_ID/SECRET` | Optional: create a GitHub OAuth App     |
| `GOOGLE_CLIENT_ID/SECRET` | Optional: create a Google OAuth App     |
| `RESEND_API_KEY`          | Optional: needed for email verification |

## 3. Start Infrastructure

Garage stores its data in `./.garage/` under the repo root. Create the directories first so the container can mount them:

```bash
mkdir -p .garage/meta .garage/data
docker compose up -d
```

This starts:

- PostgreSQL 18 on port 5432
- Redis 8 on port 6379
- Garage (S3-compatible storage) on ports 3900 (S3 API) and 3903 (admin API)
- Temporal Server on port 7233
- Temporal UI on port 8080

Wait for health checks to pass:

```bash
docker compose ps  # All services should show "healthy"
```

Then provision the Garage bucket + access key (idempotent — safe to re-run):

```bash
./scripts/bootstrap-garage.sh
```

The script prints the generated `S3_ACCESS_KEY` / `S3_SECRET_KEY`. Paste them into your `.env` (replacing the placeholder values).

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

- 7 users (all with password `password123`)
- 5 problems with testcases
- 2 contests
- 2 courses with memberships, assessments, and join tokens

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

Runs: formatting check, Prisma generation, build, lint, and tests.

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

If ports 3900, 3903, 5432, 6379, 7233, or 8080 are in use:

```bash
# Check what's using the port
lsof -i :5432

# Or modify docker-compose.yml port mappings
```

### Testing IP-based proctoring locally

Production resolves the client IP from Cloudflare's `CF-Connecting-IP` header (see [SECURITY.md — Client IP Trust Model](../SECURITY.md#client-ip-trust-model-cloudflare-only)). Locally (`NODE_ENV !== "production"`) `getClientIp(event)` reads an `x-dev-ip` request header first, then falls back to the socket address.

To exercise exam / contest IP whitelist or binding in dev:

```bash
# Pretend the request came from 10.1.2.3 (outside a campus whitelist, for example)
curl -H "x-dev-ip: 10.1.2.3" http://localhost:5173/exams/<examId>

# Pretend to be an allowed campus IP
curl -H "x-dev-ip: 140.112.30.20" http://localhost:5173/exams/<examId>
```

The override only fires when `NODE_ENV !== "production"`. Production ignores `x-dev-ip` entirely and requires `CF-Connecting-IP`.

## Related Docs

- [Architecture Overview](../../ARCHITECTURE.md)
- [Deployment Guide](../DEPLOYMENT.md)
- [Frontend Surface](../FRONTEND.md)
