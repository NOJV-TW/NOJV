# Online Judge Bootstrap Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Initialize a production-oriented Online Judge monorepo with a Next.js platform, Vite workspace client, worker pipeline, shared packages, local infrastructure, and GCP deployment scaffolding.

**Architecture:** Use a `pnpm` monorepo. Keep product-facing SSR and APIs in Next.js, keep the high-interaction IDE in a Vite app, and centralize domain contracts in shared packages so web, workspace, and worker all consume the same schemas.

**Tech Stack:** Next.js, Vite, React, Tailwind CSS, Prisma, PostgreSQL, Redis, BullMQ, Zod, ECharts, Docker Compose, ESLint, Prettier, TypeScript, i18n

---

### Task 1: Create the monorepo foundation

**Files:**

- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `turbo.json`
- Create: `.editorconfig`
- Modify: `.gitignore`

**Step 1: Write the failing test**

- No runtime behavior in this task.
- Validation command will be workspace install plus lint/test/build wiring.

**Step 2: Verify baseline**

Run: `pnpm install`
Expected: workspace lockfile resolves and all packages install.

**Step 3: Write minimal implementation**

- Add workspace root scripts for `dev`, `build`, `lint`, `test`, `format`, `db:*`.
- Ignore generated and local runtime files.

**Step 4: Run verification**

Run: `pnpm -r lint`
Expected: zero missing-config failures after scaffolding is complete.

### Task 2: Add shared config packages

**Files:**

- Create: `packages/config-eslint/*`
- Create: `packages/config-prettier/*`
- Create: `packages/config-typescript/*`

**Step 1: Write the failing test**

- No behavior test; validation is app lint and TypeScript resolution.

**Step 2: Verify red**

Run: `pnpm lint`
Expected: fail before the apps reference working shared configs.

**Step 3: Write minimal implementation**

- Export reusable ESLint, Prettier, and TypeScript presets.

**Step 4: Verify green**

Run: `pnpm lint`
Expected: command can execute against the scaffold without configuration-resolution errors.

### Task 3: Build shared domain packages with TDD

**Files:**

- Create: `packages/domain/src/*`
- Create: `packages/domain/tests/*`
- Create: `packages/queue/src/*`
- Create: `packages/queue/tests/*`
- Create: `packages/i18n/src/*`
- Create: `packages/ui/src/*`

**Step 1: Write the failing tests**

- Validate contest modes, workspace execution payloads, and cheating-signal schemas with Zod.
- Validate queue job factories reject malformed payloads.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @nojv/domain test`
Expected: missing module or failing schema assertions.

**Step 3: Write minimal implementation**

- Add enums, schemas, locale metadata, design tokens, and queue helpers.

**Step 4: Run tests**

Run: `pnpm --filter @nojv/domain test && pnpm --filter @nojv/queue test`
Expected: all tests pass.

### Task 4: Add the database package

**Files:**

- Create: `packages/db/prisma/schema.prisma`
- Create: `packages/db/src/*`
- Create: `packages/db/package.json`

**Step 1: Write the failing test**

- Validation is `prisma validate`.

**Step 2: Verify red**

Run: `pnpm --filter @nojv/db prisma:validate`
Expected: fail until schema exists.

**Step 3: Write minimal implementation**

- Model users, problems, submissions, workspace sessions, contests, cheating signals, and cheating cases.
- Add env parsing and singleton Prisma client.

**Step 4: Verify green**

Run: `pnpm --filter @nojv/db prisma:validate`
Expected: Prisma schema validates successfully.

### Task 5: Scaffold the Next.js web app

**Files:**

- Create: `apps/web/*`

**Step 1: Write the failing test**

- Validation is build/lint/typecheck.

**Step 2: Verify red**

Run: `pnpm --filter @nojv/web build`
Expected: fail until the app exists.

**Step 3: Write minimal implementation**

- App Router shell
- i18n-aware landing page
- problem dashboard, contest zone, anti-cheat overview, chart widgets
- shared theme integration

**Step 4: Verify green**

Run: `pnpm --filter @nojv/web build`
Expected: build succeeds.

### Task 6: Scaffold the Vite workspace app

**Files:**

- Create: `apps/workspace/*`

**Step 1: Write the failing test**

- Validation is Vite build.

**Step 2: Verify red**

Run: `pnpm --filter @nojv/workspace build`
Expected: fail until the app exists.

**Step 3: Write minimal implementation**

- command/workspace shell
- file tree placeholder
- editor pane
- run history
- queue-aware session contract integration

**Step 4: Verify green**

Run: `pnpm --filter @nojv/workspace build`
Expected: build succeeds.

### Task 7: Scaffold the BullMQ worker

**Files:**

- Create: `apps/worker/*`

**Step 1: Write the failing test**

- Validation is TypeScript compile plus worker smoke test entry.

**Step 2: Verify red**

Run: `pnpm --filter @nojv/worker build`
Expected: fail until worker sources exist.

**Step 3: Write minimal implementation**

- queue registration
- submission processor
- workspace-run processor
- cheating-signal processor

**Step 4: Verify green**

Run: `pnpm --filter @nojv/worker build`
Expected: build succeeds.

### Task 8: Add local infrastructure and deployment scaffolding

**Files:**

- Create: `docker-compose.yml`
- Create: `infra/docker/*`
- Create: `infra/gcp/*`
- Modify: `README.md`

**Step 1: Write the failing test**

- Validation is docker config inspection and repo-level build/test/lint.

**Step 2: Verify red**

Run: `docker compose config`
Expected: fail until compose file exists.

**Step 3: Write minimal implementation**

- PostgreSQL and Redis for local infra
- Dockerfiles for web, workspace, worker
- Cloud Run manifests and deployment notes

**Step 4: Verify green**

Run: `docker compose config`
Expected: compose file is valid.

### Task 9: Full verification

**Files:**

- No new files.

**Step 1: Run the full suite**

Run:

```bash
pnpm lint
pnpm test
pnpm build
pnpm --filter @nojv/db prisma:validate
docker compose config
```

Expected: all commands exit successfully.

**Step 2: Manual checklist**

- `apps/web` renders a Claude-inspired OJ shell.
- `apps/workspace` renders a separate IDE/workspace shell.
- Shared schemas cover contest, workspace, submission, and anti-cheat flows.
- Local infra includes PostgreSQL and Redis.
- GCP deployment docs exist.
