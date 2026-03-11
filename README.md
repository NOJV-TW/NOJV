# NOJV

NOJV is a monorepo for a production-oriented Online Judge platform.

## Status

The repository now provides a locally usable vertical slice, not a production multi-tenant SaaS.

- Practice, contest, course, problem authoring, and integrity surfaces are wired into a runnable vertical slice.
- The Monaco editor now lives directly inside `apps/web`; there is no separate workspace frontend anymore.
- Teacher-authored testcase sets persist in PostgreSQL and drive real sandbox-backed submission judging.
- BullMQ-backed worker execution now schedules submissions through Docker locally and Kubernetes jobs in production-shaped setups.
- Local infrastructure plus image-build and GKE deployment assets are in place.
- GitHub Actions CI is intended to enforce repository-wide verification only.

The next delivery phases are documented in
[`docs/plans/2026-03-08-platform-development-roadmap.md`](docs/plans/2026-03-08-platform-development-roadmap.md).

## Architecture

- `apps/web`: Next.js platform for problem browsing, inline editing, contest surfaces, course management, and integrity dashboards
- `apps/worker`: BullMQ worker boundary for submission judging and anti-cheat signal handling
- `apps/sandbox-runner`: sandbox runtime invoked by Docker or Kubernetes job execution
- `packages/domain`: shared Zod schemas for submissions, courses, integrity signals, and related contracts
- `packages/queue`: validated BullMQ job factories and queue names
- `packages/db`: Prisma 7 schema, environment parsing, and shared database client
- `packages/i18n`: shared `en` and `zh-TW` copy
- `packages/ui`: shared Claude-inspired design tokens and helpers
- `infra/docker`: local service build images
- `infra/gcp`: Cloud Build, Cloud Run, and GKE deployment assets

## Local Capabilities

- Problem detail pages with a LeetCode-style Monaco editor embedded in Next.js
- Contest detail pages that stay separate from the normal practice catalog
- Course list, course detail, assignment, and exam pages with distinct framing
- Teacher-managed enrollment via QR code, join code, or manual account creation
- Public vs private problem ownership and course problem shelves
- Teacher-authored testcase sets for real output-based evaluation
- Evidence-first telemetry path for focus loss and paste bursts
- Shared Zod contracts for submissions, verdicts, and integrity assessment
- Claude-inspired UI shell across the web experience

## What Is Included

- `apps/web`: Next.js OJ platform shell with problem, course, contest, and integrity zones
- `apps/worker`: BullMQ worker boundary for testcase-backed judging and anti-cheat events
- `apps/sandbox-runner`: isolated judge runtime embedded into the sandbox image
- `packages/db`: Prisma 7 schema and shared database client
- `packages/domain`: Zod-backed domain schemas
- `packages/queue`: queue names and validated job factories
- `packages/i18n`: shared English and Traditional Chinese copy
- `packages/ui`: Claude-inspired design tokens and shell primitives
- `docker-compose.yml`: local PostgreSQL, Redis, and service wiring
- `infra/gcp`: image build, web deployment, and GKE worker notes
- `infra/gcp/deploy.sh`: scripted image build plus web/migrator deployment entrypoint

## Local Setup

```bash
# Copy env templates
cp packages/db/.env.example packages/db/.env
cp apps/web/.env.example apps/web/.env
cp apps/worker/.env.example apps/worker/.env

# Fill in secrets in apps/web/.env (OAuth, Resend, Better Auth)

pnpm install
pnpm sandbox:build
docker compose up -d postgres redis
pnpm db:generate
pnpm db:deploy
pnpm dev
```

### Environment Files

Each package/app owns its own `.env`:

| File | Purpose |
|---|---|
| `packages/db/.env` | `DATABASE_URL` for Prisma migrations and seed |
| `apps/web/.env` | Database, Redis, Better Auth, OAuth, Resend |
| `apps/worker/.env` | Redis, sandbox execution settings |

Open:

- Web: `http://localhost:3000`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

## Running Locally

1. Start Redis and PostgreSQL with `docker compose up -d postgres redis`.
2. Build the sandbox image with `pnpm sandbox:build`.
3. Run `pnpm dev` so `web` and `worker` come up together.
4. Run `pnpm db:deploy` once after PostgreSQL is reachable so the schema exists.
5. Open `http://localhost:3000/zh-TW/courses` and use the header actor switcher plus the course creation panel.
6. Open `http://localhost:3000/zh-TW/problems` and author a new problem from the problem creation panel.
7. Open the new problem detail page and add at least one testcase set so the judge has real cases to execute.
8. Open the target course detail page and use the course action panel to attach problems, publish an assessment, or enroll members.

Current local behavior:

- Submissions execute inside the sandbox runtime and compare outputs against persisted testcase sets.
- Integrity telemetry batches recent editor events and returns a shared risk score.
- Course assignments and exams carry course assessment context through submissions and integrity records.
- Teachers can create courses, author public/private problems, attach problems to courses, publish assessments, and add testcase sets directly from the UI.
- Submission, signal, and case records persist through Prisma into PostgreSQL.
- `GET /api/runtime/stats` feeds the integrity page with live persisted counters.
- The local execution path is `web -> Redis -> worker -> sandbox-runner -> Postgres`.

## Course Management

The course extension still uses a two-layer access model:

- Platform identity for sign-in and global capabilities
- Course membership role for per-course management permissions

Current local semantics:

- Staff can create courses and manage enrollments.
- Course teachers and TAs can add members, attach problems, and publish assignments or exams.
- Students join seeded courses through QR code or join code, or are manually enrolled by staff.
- Private problems stay hidden from the public catalog but remain available inside course shelves and assessments.

Important routes:

- `POST /api/courses`
- `POST /api/problems`
- `POST /api/courses/:slug/join`
- `POST /api/courses/:slug/members`
- `POST /api/courses/:slug/problems`
- `POST /api/courses/:slug/assessments`

Actor identity is still header-driven under the hood, but local use no longer requires manual header entry. The web header exposes a local actor switcher that automatically sends:

- `x-nojv-actor-id`
- `x-nojv-platform-role`
- `x-nojv-display-name`
- `x-nojv-email`
- `x-nojv-handle`

Example:

```bash
curl -X POST http://localhost:3000/api/courses \
  -H 'Content-Type: application/json' \
  -H 'x-nojv-actor-id: usr_teacher_demo' \
  -H 'x-nojv-platform-role: teacher' \
  -d '{
    "slug": "compiler-design-2026",
    "title": "Compiler Design",
    "description": "Course-managed judge surface for compilers.",
    "locale": "zh-TW"
  }'
```

## Developer Workflow

1. Install dependencies with `pnpm install`.
2. Start local infra with `docker compose up -d postgres redis`.
3. Build the sandbox runtime with `pnpm sandbox:build`.
4. Generate Prisma client with `pnpm db:generate`.
5. Run active development with `pnpm dev`.
6. Before pushing, run `pnpm ci:verify`.

If you only need a subset:

```bash
pnpm format
pnpm lint
pnpm test
pnpm build
pnpm db:validate
docker compose config
```

## CI

GitHub Actions CI should run on every pull request and on pushes to `main`.

- Workflow file: [/.github/workflows/ci.yml](/Users/takala/code/NOJV/.github/workflows/ci.yml)
- Root verification command: `pnpm ci:verify`

The CI job is intentionally limited to repository verification:

- formatting
- lint
- tests
- builds
- Prisma schema validation
- Docker Compose configuration validation

It does not deploy to GCP in this phase.

## Sandbox Runtime

Submission judging now goes through a dedicated sandbox image.

- Image Dockerfile: `infra/docker/sandbox-runner.Dockerfile`
- Default image tag: `nojv-sandbox:local`
- Default limits: `1 CPU`, `256 MB`, `64 pids`, `network=none`
- Hardening: `cap-drop ALL`, `no-new-privileges`, `read-only rootfs`, `tmpfs /tmp`

Build the image locally with either:

```bash
pnpm sandbox:build
```

or:

```bash
docker compose build sandbox-image
```

The worker chooses its executor through `EXECUTION_BACKEND`:

- backend selector: `EXECUTION_BACKEND`
- local default: `docker`
- Kubernetes target: `kubernetes`

## GCP Deployment

The current GCP shape is:

- `web`: Cloud Run service
- `migrator`: Cloud Run Job running `prisma migrate deploy`
- `worker`: GKE deployment with KEDA autoscaling
- `sandbox`: per-submission Kubernetes Jobs using the sandbox-runner image
- `postgres`: Cloud SQL
- `redis`: Memorystore
- `images`: Artifact Registry
- `secrets`: Secret Manager for app connection strings

Deployment assets live under `infra/gcp`, and sandbox namespace guardrails live under `infra/k8s/sandbox`.

Build and deploy entrypoints:

```bash
gcloud builds submit --config infra/gcp/cloudbuild.yaml \
  --substitutions _REGION=asia-east1,_REPOSITORY=nojv,_IMAGE_TAG=release-20260308
```

or:

```bash
pnpm deploy:gcp
```

`pnpm deploy:gcp` expects:

- `PROJECT_ID`
- `DATABASE_URL`
- `REDIS_URL`
- `IMAGE_TAG` optional

`deploy.sh` now:

1. builds tagged images through Cloud Build
2. creates or updates Secret Manager values
3. runs the `migrator` Cloud Run Job
4. deploys `web`
5. prints the `worker` and `sandbox` image refs for the separate GKE rollout

This workstation still needs a working `gcloud` installation plus project authentication before an actual rollout can happen.

## Plans And Roadmap

- Current platform roadmap:
  [`docs/plans/2026-03-08-platform-development-roadmap.md`](docs/plans/2026-03-08-platform-development-roadmap.md)
- Latest app restructure plan:
  [`docs/plans/2026-03-10-app-restructure-plan.md`](docs/plans/2026-03-10-app-restructure-plan.md)
- Latest cloud-native sandbox design:
  [`docs/plans/2026-03-10-cloud-native-sandbox-design.md`](docs/plans/2026-03-10-cloud-native-sandbox-design.md)
- Latest cleanup plan:
  [`docs/plans/2026-03-10-codebase-clarity-cleanup-plan.md`](docs/plans/2026-03-10-codebase-clarity-cleanup-plan.md)
