# Online Judge Platform Design

## Goals

- Build a production-grade Online Judge with a LeetCode-style in-browser editor.
- Provide an isolated workspace that can run `make`, shell commands, and project-based assignments.
- Separate standard practice flows from contest flows.
- Capture anti-cheat signals end-to-end instead of bolting them on later.
- Ship a Claude-inspired product surface and a GCP-ready deployment model.

## Recommended Architecture

### Option A: Single Next.js app plus background worker

- Lowest operational complexity.
- Weak fit for the interactive workspace because terminal, file tree, and long-lived session streaming become awkward inside the same app surface.

### Option B: Monorepo with Next.js platform, Vite workspace client, and BullMQ worker

- Recommended.
- Next.js owns SSR, auth, public OJ pages, contest pages, and most APIs.
- Vite owns the high-interaction browser IDE and terminal client, loaded as a dedicated workspace application.
- BullMQ worker owns judge execution, plagiarism analysis, and contest scoring side effects.

### Option C: Fully decomposed microservices

- Maximum isolation.
- Too expensive for the first version and creates deployment friction before product risk is reduced.

This design uses Option B because it isolates the hardest interactive surface without forcing the entire platform into distributed-system overhead.

## Monorepo Layout

```text
apps/
  web/                 Next.js platform UI + route handlers
  workspace/           Vite React IDE / terminal client
  worker/              BullMQ consumers for judging and anti-cheat
packages/
  config-eslint/       Shared ESLint config
  config-prettier/     Shared Prettier config
  config-typescript/   Shared TypeScript bases
  db/                  Prisma schema, client, seed helpers
  domain/              Zod models, enums, domain helpers
  queue/               BullMQ queues, job names, payload contracts
  i18n/                Shared dictionaries and locale metadata
  ui/                  Shared Tailwind-aware design tokens / primitives
infra/
  docker/              Dockerfiles for web, workspace, worker
  gcp/                 Cloud Run deployment notes and manifests
```

## Product Areas

### 1. Platform UI

- Problem list, problem detail, submissions, results, user dashboard, course assignments.
- Admin-facing chart widgets backed by ECharts for queue health, contest activity, plagiarism flags, and language usage.

### 2. Workspace UI

- Monaco-like editing surface is the long-term target, but the initial scaffold uses a code-editor shell component and terminal cards with clean extension points.
- Session lifecycle: create workspace, attach to session, stream terminal output, enqueue run task, persist run metadata.
- Every workspace maps to an ephemeral sandbox container with its own filesystem and execution policy.

### 3. Contest Surface

- Contest landing page, countdown, problem set, frozen scoreboard, anti-cheat session binding.
- Separate route group and separate authorization checks from normal practice mode.

### 4. Judge and Anti-Cheat Pipeline

- Submission and workspace-run events enter Redis-backed BullMQ queues.
- Worker fans out into:
  - compile-and-run pipeline
  - output diff / scoring pipeline
  - plagiarism / similarity pipeline
  - telemetry anomaly pipeline
- Suspicion is modeled as evidence, not a boolean.

## Core Domain Model

### Core entities

- `User`
- `Problem`
- `ProblemStatementI18n`
- `TestcaseSet`
- `Submission`
- `WorkspaceSession`
- `WorkspaceRun`
- `Contest`
- `ContestProblem`
- `ContestRegistration`
- `ContestParticipation`
- `CheatingSignal`
- `CheatingCase`

### Important relationships

- A `Submission` belongs to either practice mode or a contest participation context.
- A `WorkspaceSession` is distinct from a `Submission`; users may run many private commands before they submit.
- `CheatingSignal` stores low-level facts such as tab switching, IP change, suspicious similarity score, shell policy violation, or multi-account overlap.
- `CheatingCase` aggregates signals for reviewer workflows and automated escalation.

## Anti-Cheat Model

“完整的作弊檢測” should be treated as a layered evidence system:

1. Client telemetry

- focus/blur
- paste frequency
- abnormal typing bursts
- contest page visibility changes

2. Identity and environment

- IP drift
- user agent changes
- concurrent sessions
- fingerprint mismatch

3. Code similarity

- AST normalization
- token shingling
- pairwise fingerprint comparison
- cross-contest and historical comparisons

4. Execution anomalies

- repeated compile probes
- shell policy violations
- forbidden command attempts
- suspicious workspace-to-submission timing

5. Review support

- reviewer queue
- evidence timeline
- configurable thresholds per contest

The initial scaffold includes the schemas, queue contracts, and dashboard placeholders for this pipeline.

## Isolation and Security

- Practice submissions and workspace runs never execute inside the web process.
- Worker only schedules jobs; sandbox executors run in ephemeral containers.
- Assignment workspace images must support `make`, GCC/Clang, Node, Python, and shell tooling by mounting a per-session writable volume.
- Use a strict allowlist for commands in contest mode and a broader course-workspace policy in assignment mode.
- Persist only artifacts and metadata that are needed for auditing.

## GCP Deployment

### Recommended services

- Cloud Run: `web`, `workspace`, `worker`
- Cloud SQL for PostgreSQL
- Memorystore for Redis
- Artifact Registry for container images
- Cloud Build or GitHub Actions for CI/CD
- Cloud Storage for problem assets, submission artifacts, and replayable logs
- Secret Manager for runtime secrets

### Deployment shape

- `web` serves SSR pages and APIs.
- `workspace` serves the Vite-built static client or lightweight Node host for the IDE surface.
- `worker` consumes BullMQ jobs and calls sandbox infrastructure.
- Sandbox execution can later move to GKE Autopilot or Cloud Run Jobs, but the first framework keeps that boundary abstract.

## Design Direction

- Claude-inspired palette: warm neutrals, low-saturation accents, restrained contrast.
- Editorial typography for headings, dense utility typography for data-heavy views.
- Card surfaces with subtle borders instead of loud shadows.
- The workspace client should feel like a focused lab, not a generic admin panel.

## First Initialization Scope

- Monorepo with `pnpm` workspaces
- Next.js web app
- Vite workspace app
- Prisma schema and seed-ready client package
- BullMQ queue contracts and worker stub
- Shared Tailwind, ESLint, Prettier, TypeScript config
- Shared i18n dictionaries and Zod domain schemas
- Docker Compose for PostgreSQL and Redis
- GCP deployment notes and starter manifests
- Tests for domain schemas and queue contracts
