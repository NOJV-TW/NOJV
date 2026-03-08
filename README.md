# NOJV

NOJV is a monorepo for a production-oriented Online Judge platform.

## Status

The repository now provides a locally usable vertical slice, not a production multi-tenant SaaS.

- Practice, contest, course, workspace, and integrity surfaces are wired into a runnable vertical slice.
- Problem submissions, workspace runs, and integrity signals all travel through shared contracts.
- Teacher / TA / student / admin course-management flows now exist as real routes and UI surfaces.
- Web and workspace both expose a local actor switcher, so role-based flows work without hand-written request headers.
- Teacher-authored testcase sets now persist in PostgreSQL and drive real sandbox-backed submission judging.
- BullMQ-backed worker execution now runs `make` and command payloads inside Docker sandboxes backed by per-run temp workspaces.
- Local infrastructure plus GCP baseline and scale-out deployment assets are in place.
- GitHub Actions CI is intended to enforce repository-wide verification only.

The next delivery phases are documented in
[`docs/plans/2026-03-08-platform-development-roadmap.md`](docs/plans/2026-03-08-platform-development-roadmap.md).

## Architecture

- `apps/web`: Next.js platform for problem browsing, contest surfaces, course management, and integrity dashboards
- `apps/workspace`: Vite workspace client for browser-based editing and isolated command execution UX
- `apps/worker`: BullMQ worker boundary for submission judging, workspace runs, and anti-cheat signal handling
- `apps/sandbox`: dedicated execution service for production deployment targets where Docker-in-Docker is not available
- `packages/domain`: shared Zod schemas for submissions, contests, workspace runs, and cheating evidence
- `packages/queue`: validated BullMQ job factories and queue names
- `packages/db`: Prisma 7 schema, environment parsing, and shared database client
- `packages/i18n`: shared `en` and `zh-TW` copy
- `packages/ui`: shared Claude-inspired design tokens and helpers
- `infra/docker`: local service build images
- `infra/gcp`: Cloud Run, Cloud Run Job, and GKE deployment assets

## Local Capabilities

- Problem detail pages with a LeetCode-style Monaco editor embedded in Next.js
- Workspace app in Vite that sends files plus commands to a queue-backed API
- Contest detail pages that stay separate from the normal practice catalog
- Course list, course detail, assignment, and exam pages with distinct framing
- Teacher-managed enrollment via QR code, join code, or manual account creation
- Public vs private problem ownership and course problem shelves
- Teacher-authored testcase sets for real output-based evaluation
- Evidence-first telemetry path for focus loss and paste bursts
- Shared Zod contracts for submissions, workspace runs, verdicts, and integrity assessment
- Claude-inspired UI shell across web and workspace surfaces

## What Is Included

- `apps/web`: Next.js OJ platform shell with problem, contest, and integrity zones
- `apps/workspace`: Vite-based isolated IDE / terminal workspace shell
- `apps/worker`: BullMQ worker boundary for testcase-backed judging, workspace execution, and anti-cheat events
- `apps/sandbox`: internal sandbox HTTP service for Cloud Run execution
- `packages/db`: Prisma 7 schema and shared database client
- `packages/domain`: Zod-backed domain schemas
- `packages/queue`: queue names and validated job factories
- `packages/i18n`: shared English and Traditional Chinese copy
- `packages/ui`: Claude-inspired design tokens and shell primitives
- `docker-compose.yml`: local PostgreSQL, Redis, and service wiring
- `infra/gcp`: Cloud Run starter manifests, Cloud Run Job config, and GKE notes
- `infra/gcp/deploy.sh`: scripted GCP deployment entrypoint

## Local Setup

```bash
cp .env.example .env
pnpm install
pnpm sandbox:build
docker compose up -d postgres redis
pnpm db:generate
pnpm db:deploy
pnpm dev
```

Open:

- Web: `http://localhost:3000`
- Workspace: `http://localhost:4173`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

Cross-app URLs come from `.env`:

- `NEXT_PUBLIC_WORKSPACE_URL` controls web-to-workspace links
- `VITE_NOJV_WEB_ORIGIN` controls workspace-to-web API calls

## Running Locally

1. Start Redis and PostgreSQL with `docker compose up -d postgres redis`.
2. Build the sandbox image with `pnpm sandbox:build`.
3. Run `pnpm dev` so `web`, `workspace`, and `worker` come up together.
4. Run `pnpm db:deploy` once after PostgreSQL is reachable so the schema exists.
5. Open `http://localhost:3000/zh-TW/courses` and use the header actor switcher plus the course creation panel.
6. Open `http://localhost:3000/zh-TW/problems` and author a new problem from the problem creation panel.
7. Open the new problem detail page and add at least one testcase set so the judge has real cases to execute.
8. Open the target course detail page and use the course action panel to attach problems, publish an assessment, or enroll members.
9. Open `http://localhost:4173` or launch workspace from a problem page to run isolated commands with the selected actor identity.

Current local behavior:

- Submissions execute inside the sandbox runtime and compare outputs against persisted testcase sets.
- Workspace runs execute real commands from uploaded file payloads inside short-lived Docker sandboxes.
- Production deployment targets switch the worker to a dedicated remote sandbox service instead of Docker-in-Docker.
- Integrity telemetry batches recent editor events and returns a shared risk score.
- Contest mode applies a narrower workspace command allowlist.
- Course assignments and exams carry course assessment context through submissions, workspace runs, and integrity records.
- Teachers can create courses, author public/private problems, attach problems to courses, publish assessments, and add testcase sets directly from the UI.
- Submission, workspace, signal, and case records persist through Prisma into PostgreSQL.
- `GET /api/runtime/stats` feeds the integrity page with live persisted counters.
- The production-shaped path has been smoke-tested locally as `web -> Redis -> worker -> remote sandbox -> Postgres`.

## Course Management

The course extension uses a two-layer access model:

- Platform role: `admin`, `teacher`, `ta`, `student`
- Course membership role: `teacher`, `ta`, `student`

Current local semantics:

- `teacher` and `admin` can create courses and problems.
- Course `teacher`, `ta`, and `admin` can add members, attach problems, and publish assignments or exams.
- Students join seeded courses through QR code or join code, or are manually enrolled by staff.
- Private problems are hidden from the public catalog but remain available inside course shelves and assessments.

Important routes:

- `POST /api/courses`
- `POST /api/problems`
- `POST /api/courses/:slug/join`
- `POST /api/courses/:slug/members`
- `POST /api/courses/:slug/problems`
- `POST /api/courses/:slug/assessments`

Actor identity is still header-driven under the hood, but local use no longer requires manual header entry. The web and workspace headers expose a local actor switcher that automatically sends:

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

Workspace and assessment command execution now goes through a dedicated Docker sandbox image.

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

For production deployment targets, the worker can switch to the dedicated sandbox service:

- backend selector: `EXECUTION_BACKEND`
- local default: `docker_local`
- GCP target: `remote_http`
- remote target URL: `SANDBOX_BASE_URL`
- remote bearer token: `SANDBOX_SHARED_TOKEN`

## GCP Deployment

The baseline production split on GCP is:

- `web`: Cloud Run service
- `workspace`: Cloud Run service
- `worker`: Cloud Run service with `min-instances=1` and HTTP health probes
- `sandbox`: Cloud Run service with container concurrency pinned to `1`
- `migrator`: Cloud Run Job running `prisma migrate deploy`
- `postgres`: Cloud SQL
- `redis`: Memorystore
- `images`: Artifact Registry
- `secrets`: Secret Manager

For higher sustained traffic, the repo also includes a scale-out path:

- keep `web` and `workspace` on Cloud Run
- move `worker` to GKE with KEDA autoscaling on BullMQ wait-list depth
- move `sandbox` to GKE with HPA and internal-only service discovery
- manifests live under `infra/gcp/gke`

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
- `SANDBOX_SHARED_TOKEN`
- `IMAGE_TAG` optional

`deploy.sh` now:

1. builds tagged images through Cloud Build
2. creates or updates Secret Manager values
3. runs the `migrator` Cloud Run Job
4. deploys `sandbox`, `workspace`, `web`, and `worker`

This workstation still needs a working `gcloud` installation plus project authentication before an actual rollout can happen.

## Plans And Roadmap

- Bootstrap implementation plan:
  [`docs/plans/2026-03-08-online-judge-bootstrap.md`](docs/plans/2026-03-08-online-judge-bootstrap.md)
- POC implementation plan:
  [`docs/plans/2026-03-08-poc-implementation-plan.md`](docs/plans/2026-03-08-poc-implementation-plan.md)
- POC completion and report plan:
  [`docs/plans/2026-03-08-poc-completion-and-report-plan.md`](docs/plans/2026-03-08-poc-completion-and-report-plan.md)
- CI and docs implementation plan:
  [`docs/plans/2026-03-08-ci-and-docs-plan.md`](docs/plans/2026-03-08-ci-and-docs-plan.md)
- Platform roadmap:
  [`docs/plans/2026-03-08-platform-development-roadmap.md`](docs/plans/2026-03-08-platform-development-roadmap.md)
- Prod topology design:
  [`docs/plans/2026-03-08-prod-topology-design.md`](docs/plans/2026-03-08-prod-topology-design.md)
- Course management POC plan:
  [`docs/plans/2026-03-08-course-management-poc-plan.md`](docs/plans/2026-03-08-course-management-poc-plan.md)
- POC architecture report:
  [`docs/reports/2026-03-08-poc-architecture-report.md`](docs/reports/2026-03-08-poc-architecture-report.md)
- Prod and GCP architecture report:
  [`docs/reports/2026-03-08-prod-gcp-architecture-report.md`](docs/reports/2026-03-08-prod-gcp-architecture-report.md)
- Course management report:
  [`docs/reports/2026-03-08-course-management-poc-report.md`](docs/reports/2026-03-08-course-management-poc-report.md)
