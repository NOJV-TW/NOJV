# Architecture Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor NOJV from a monolithic web app into a multi-tier architecture with proper layer separation (Presentation → Service → Persistence → Data) and cross-cutting Infrastructure packages.

**Architecture:** Create 3 new packages (`@nojv/redis`, `@nojv/job-dispatch`, `@nojv/domain`), add repository pattern to `@nojv/db`, then migrate all business logic from `apps/web/src/lib/server/` into `@nojv/domain` and update `@nojv/temporal` activities to call domain functions instead of direct Prisma access.

**Tech Stack:** TypeScript ESM, pnpm workspaces, tsdown build, Prisma 7, ioredis, @temporalio/client

**Reference:** See `docs/plans/2026-04-02-microservice-architecture-redesign.md` for architecture decisions and rationale.

---

## Phase 1: Create `@nojv/redis` Package

Extract all Redis operations from `apps/web/src/lib/server/redis.ts` and `packages/temporal/src/activities/redis.ts` + `notification.ts` into a shared package.

### Task 1.1: Scaffold `@nojv/redis` package

**Files:**
- Create: `packages/redis/package.json`
- Create: `packages/redis/tsconfig.json`
- Create: `packages/redis/tsdown.config.ts`

**Step 1: Create package.json**

```json
{
  "name": "@nojv/redis",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./dist/index.mjs"
    }
  },
  "scripts": {
    "build": "tsdown",
    "lint": "eslint .",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@nojv/core": "workspace:*",
    "ioredis": "^5.9.3"
  },
  "devDependencies": {
    "tsdown": "^0.21.2"
  }
}
```

**Step 2: Create tsconfig.json** (same pattern as `packages/core/tsconfig.json`)

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "."
  },
  "include": ["src/**/*.ts"]
}
```

**Step 3: Create tsdown.config.ts** (copy from `packages/core/` if exists, else minimal)

**Step 4: Run `pnpm install` to link workspace**

Run: `pnpm install`

### Task 1.2: Create Redis connection module

**Files:**
- Create: `packages/redis/src/connection.ts`

**Source logic from:** `apps/web/src/lib/server/redis.ts:1-14` and `packages/temporal/src/activities/redis.ts:1-15`

```typescript
import Redis from "ioredis";
import { parseRedisConnection } from "@nojv/core";

let _redis: Redis | undefined;

export function getRedis(): Redis {
  if (!_redis) {
    const opts = parseRedisConnection(process.env.REDIS_URL ?? "redis://localhost:6379");
    _redis = new Redis({ host: opts.host, port: opts.port, password: opts.password });
  }
  return _redis;
}

export function createSubscriber(redisUrl?: string): Redis {
  const opts = parseRedisConnection(redisUrl ?? process.env.REDIS_URL ?? "redis://localhost:6379");
  return new Redis({ host: opts.host, port: opts.port, password: opts.password });
}
```

### Task 1.3: Create key registry

**Files:**
- Create: `packages/redis/src/keys.ts`

Centralize all Redis key patterns currently scattered across codebase:

```typescript
const PREFIX = "nojv";

export const keys = {
  userChannel: (userId: string) => `${PREFIX}:user:${userId}`,
  scoreboard: (contestId: string) => `${PREFIX}:scoreboard:${contestId}`,
  scoreboardFrozen: (contestId: string) => `${PREFIX}:scoreboard:${contestId}:frozen`,
  cooldown: (userId: string, problemId: string) => `${PREFIX}:cooldown:${userId}:${problemId}`,
  cache: (key: string) => `${PREFIX}:cache:${key}`,
} as const;
```

Note: The existing code uses `userChannel()` from `@nojv/core` (returns `user:{userId}` without prefix). The `@nojv/redis` version adds the `nojv:` prefix for consistency. Check all pub/sub subscribers to ensure they use the same channel names. The SSE subscriber in `apps/web` must match. Verify by grepping for `userChannel` and `user:${` across the codebase.

### Task 1.4: Create pub/sub module

**Files:**
- Create: `packages/redis/src/pubsub.ts`

**Source logic from:** `packages/temporal/src/activities/notification.ts` (full file)

```typescript
import type { SSEEvent } from "@nojv/core";
import {
  SSE_ASSIGNMENT_DEADLINE,
  SSE_CONTEST_ENDING,
  SSE_CONTEST_STARTING,
  SSE_SUBMISSION_VERDICT,
} from "@nojv/core";

import { getRedis } from "./connection";
import { keys } from "./keys";

function publishEvent(channel: string, event: SSEEvent): Promise<number> {
  return getRedis().publish(channel, JSON.stringify(event));
}

export async function publishVerdict(submission: {
  id: string;
  problemId: string;
  problemSlug: string;
  score: number;
  status: string;
  userId: string;
}): Promise<void> {
  try {
    await publishEvent(keys.userChannel(submission.userId), {
      type: SSE_SUBMISSION_VERDICT,
      submissionId: submission.id,
      verdict: submission.status,
      score: submission.score,
      problemId: submission.problemId,
      problemSlug: submission.problemSlug,
    });
  } catch {
    // Non-critical
  }
}

export async function publishContestEvent(
  contestId: string,
  eventType: "starting" | "ending"
): Promise<void> {
  const event: SSEEvent =
    eventType === "starting" ? { type: SSE_CONTEST_STARTING } : { type: SSE_CONTEST_ENDING };
  try {
    await publishEvent(`contest:${contestId}`, event);
  } catch {
    // Non-critical
  }
}

export async function publishAssessmentDeadline(assessmentId: string): Promise<void> {
  try {
    await publishEvent(`assessment:${assessmentId}`, { type: SSE_ASSIGNMENT_DEADLINE });
  } catch {
    // Non-critical
  }
}
```

### Task 1.5: Create cooldown, scoreboard, cache modules

**Files:**
- Create: `packages/redis/src/cooldown.ts`
- Create: `packages/redis/src/scoreboard.ts`
- Create: `packages/redis/src/cache.ts`

**Source logic from:** `apps/web/src/lib/server/redis.ts:22-88` (identical logic in both web and temporal redis files)

**cooldown.ts:**
```typescript
import { getRedis } from "./connection";
import { keys } from "./keys";

export async function setCooldown(userId: string, problemId: string, seconds: number): Promise<boolean> {
  const result = await getRedis().set(keys.cooldown(userId, problemId), "1", "EX", seconds, "NX");
  return result === "OK";
}

export async function checkCooldown(userId: string, problemId: string): Promise<boolean> {
  return (await getRedis().exists(keys.cooldown(userId, problemId))) === 1;
}
```

**scoreboard.ts:**
```typescript
import { getRedis } from "./connection";
import { keys } from "./keys";

export async function updateScoreboard(
  contestId: string, participationId: string, score: number
): Promise<void> {
  await getRedis().zadd(keys.scoreboard(contestId), score.toString(), participationId);
}

export async function getScoreboard(
  contestId: string, start = 0, stop = -1
): Promise<{ participationId: string; score: number }[]> {
  const results = await getRedis().zrevrange(keys.scoreboard(contestId), start, stop, "WITHSCORES");
  const entries: { participationId: string; score: number }[] = [];
  for (let i = 0; i + 1 < results.length; i += 2) {
    const participationId = results[i];
    const scoreStr = results[i + 1];
    if (participationId != null && scoreStr != null) {
      entries.push({ participationId, score: Number(scoreStr) });
    }
  }
  return entries;
}

export async function freezeScoreboard(contestId: string): Promise<void> {
  await getRedis().rename(keys.scoreboard(contestId), keys.scoreboardFrozen(contestId));
}

export async function unfreezeScoreboard(contestId: string): Promise<void> {
  const frozenKey = keys.scoreboardFrozen(contestId);
  const exists = await getRedis().exists(frozenKey);
  if (exists) {
    await getRedis().rename(frozenKey, keys.scoreboard(contestId));
  }
}
```

**cache.ts:**
```typescript
import { getRedis } from "./connection";
import { keys } from "./keys";

export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await getRedis().get(keys.cache(key));
  if (!raw) return null;
  return JSON.parse(raw) as T;
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await getRedis().set(keys.cache(key), JSON.stringify(value), "EX", ttlSeconds);
}

export async function cacheDel(key: string): Promise<void> {
  await getRedis().del(keys.cache(key));
}
```

### Task 1.6: Create package index

**Files:**
- Create: `packages/redis/src/index.ts`

```typescript
export { getRedis, createSubscriber } from "./connection";
export { keys } from "./keys";

export * as pubsub from "./pubsub";
export * as cooldown from "./cooldown";
export * as scoreboard from "./scoreboard";
export * as cache from "./cache";
```

### Task 1.7: Build and verify

Run: `cd packages/redis && pnpm build && pnpm typecheck`

### Task 1.8: Update temporal activities to use `@nojv/redis`

**Files:**
- Modify: `packages/temporal/src/activities/redis.ts` — replace with re-exports from `@nojv/redis`
- Modify: `packages/temporal/src/activities/notification.ts` — replace with re-exports from `@nojv/redis`
- Modify: `packages/temporal/package.json` — add `@nojv/redis` dependency

**redis.ts** becomes:
```typescript
export {
  getRedis,
  scoreboard,
  cooldown,
  cache,
} from "@nojv/redis";

// Re-export flat functions for backward compatibility with activity bundles
export const updateScoreboard = (await import("@nojv/redis")).scoreboard.updateScoreboard;
// ... etc
```

Actually, simpler approach: keep the activity files as thin wrappers that call `@nojv/redis` functions. This way bundle exports don't break. Update each function body to delegate.

**notification.ts** becomes:
```typescript
import { pubsub } from "@nojv/redis";

export const publishVerdict = pubsub.publishVerdict;
export const publishContestEvent = pubsub.publishContestEvent;
export const publishAssessmentDeadline = pubsub.publishAssessmentDeadline;
```

### Task 1.9: Update web app to use `@nojv/redis`

**Files:**
- Modify: `apps/web/src/lib/server/redis.ts` — replace implementation with re-exports from `@nojv/redis`
- Modify: `apps/web/package.json` — add `@nojv/redis`, remove `ioredis`

**redis.ts** becomes thin re-export:
```typescript
export { createSubscriber } from "@nojv/redis";
export { setCooldown, checkCooldown } from "@nojv/redis/cooldown";
// ... or just:
export * from "@nojv/redis";
```

Check all imports from `$lib/server/redis` across the web app and update them.

### Task 1.10: Build, typecheck, verify

Run: `pnpm build && pnpm lint`

Expected: All packages build without errors.

### Task 1.11: Commit

```bash
git add packages/redis/ packages/temporal/src/activities/redis.ts packages/temporal/src/activities/notification.ts packages/temporal/package.json apps/web/src/lib/server/redis.ts apps/web/package.json pnpm-lock.yaml
git commit -m "refactor: extract @nojv/redis package from web and temporal"
```

---

## Phase 2: Create `@nojv/job-dispatch` Package

Extract Temporal client dispatch logic from `apps/web/src/lib/server/queue.ts`.

### Task 2.1: Scaffold `@nojv/job-dispatch` package

**Files:**
- Create: `packages/job-dispatch/package.json`
- Create: `packages/job-dispatch/tsconfig.json`

**package.json:**
```json
{
  "name": "@nojv/job-dispatch",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./dist/index.mjs"
    }
  },
  "scripts": {
    "build": "tsdown",
    "lint": "eslint .",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@nojv/core": "workspace:*",
    "@temporalio/client": "^1.11.7"
  },
  "devDependencies": {
    "tsdown": "^0.21.2"
  }
}
```

Run: `pnpm install`

### Task 2.2: Create Temporal client wrapper

**Files:**
- Create: `packages/job-dispatch/src/client.ts`

**Source logic from:** `packages/temporal/src/client.ts` (singleton pattern)

```typescript
import { Client, Connection } from "@temporalio/client";

let _client: Client | undefined;
let _connection: Connection | undefined;

export async function getClient(): Promise<Client> {
  if (_client) return _client;
  const address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
  const namespace = process.env.TEMPORAL_NAMESPACE ?? "default";
  _connection = await Connection.connect({ address });
  _client = new Client({ connection: _connection, namespace });
  return _client;
}

export async function closeClient(): Promise<void> {
  if (_connection) {
    await _connection.close();
    _connection = undefined;
    _client = undefined;
  }
}
```

### Task 2.3: Create dispatch functions

**Files:**
- Create: `packages/job-dispatch/src/dispatch.ts`

**Source logic from:** `apps/web/src/lib/server/queue.ts` + type imports from `packages/temporal/src/types.ts`

Note: `@nojv/job-dispatch` does NOT depend on `@nojv/temporal`. Workflow names and task queue names are string literals. Input types come from `@nojv/core` (move `SubmissionJudgeJob` type there if needed) or are re-defined locally.

```typescript
import { submissionJudgeJobSchema, type SubmissionJudgeJob } from "@nojv/core";

import { getClient } from "./client";

const JUDGE_TASK_QUEUE = "judge";
const PLATFORM_TASK_QUEUE = "platform";

export async function submitJudge(payload: SubmissionJudgeJob): Promise<void> {
  const validated = submissionJudgeJobSchema.parse(payload);
  const client = await getClient();
  await client.workflow.start("submissionJudgeWorkflow", {
    taskQueue: JUDGE_TASK_QUEUE,
    workflowId: `judge-${validated.submissionId}`,
    args: [{ submissionId: validated.submissionId, draft: validated.draft }],
  });
}

export async function startContestLifecycle(contestId: string): Promise<void> {
  const client = await getClient();
  await client.workflow.start("contestLifecycleWorkflow", {
    taskQueue: PLATFORM_TASK_QUEUE,
    workflowId: `contest-lifecycle-${contestId}`,
    args: [{ contestId }],
  });
}

export async function startAssessmentLifecycle(assessmentId: string): Promise<void> {
  const client = await getClient();
  await client.workflow.start("assessmentLifecycleWorkflow", {
    taskQueue: PLATFORM_TASK_QUEUE,
    workflowId: `assessment-lifecycle-${assessmentId}`,
    args: [{ assessmentId }],
  });
}

export async function triggerPlagiarismCheck(input: {
  reportId: string;
  targetId: string;
  targetType: "courseAssessment" | "contest";
  triggeredById: string;
}): Promise<void> {
  const client = await getClient();
  await client.workflow.start("plagiarismCheckWorkflow", {
    taskQueue: PLATFORM_TASK_QUEUE,
    workflowId: `plagiarism-${input.reportId}`,
    args: [input],
  });
}

export async function startRejudge(input: {
  problemId: string;
  contestId?: string;
  assessmentId?: string;
}): Promise<void> {
  const client = await getClient();
  const id = input.contestId ?? input.assessmentId ?? input.problemId;
  await client.workflow.start("rejudgeWorkflow", {
    taskQueue: JUDGE_TASK_QUEUE,
    workflowId: `rejudge-${id}-${Date.now()}`,
    args: [input],
  });
}
```

Important: Verify the workflow names and args match exactly what `packages/temporal/src/workflows/` exports. Check each workflow file's function name and input type.

### Task 2.4: Create package index

**Files:**
- Create: `packages/job-dispatch/src/index.ts`

```typescript
export {
  submitJudge,
  startContestLifecycle,
  startAssessmentLifecycle,
  triggerPlagiarismCheck,
  startRejudge,
} from "./dispatch";

export { closeClient } from "./client";
```

### Task 2.5: Build and verify

Run: `cd packages/job-dispatch && pnpm build && pnpm typecheck`

### Task 2.6: Update web app to use `@nojv/job-dispatch`

**Files:**
- Modify: `apps/web/src/lib/server/queue.ts` — replace with re-export from `@nojv/job-dispatch`
- Modify: `apps/web/package.json` — add `@nojv/job-dispatch` dep, remove `@nojv/temporal`

**queue.ts** becomes:
```typescript
export { submitJudge as dispatchSubmissionJob } from "@nojv/job-dispatch";
```

Grep for all imports from `$lib/server/queue` and `@nojv/temporal` in the web app. Update them to use `@nojv/job-dispatch` if they're just dispatching jobs. If they use `getTemporalClient()` directly (e.g., for workflow queries), those need to be moved to domain later.

Note: The web app may also use `getTemporalClient()` for submission status polling via `workflow.query()`. Check `apps/web/src/routes/api/submissions/[id]/stream/+server.ts` and similar files. Those should eventually go through `@nojv/job-dispatch` as well (add a `querySubmissionStatus()` function).

### Task 2.7: Build, typecheck, verify

Run: `pnpm build && pnpm lint`

### Task 2.8: Commit

```bash
git add packages/job-dispatch/ apps/web/src/lib/server/queue.ts apps/web/package.json pnpm-lock.yaml
git commit -m "refactor: extract @nojv/job-dispatch package from web"
```

---

## Phase 3: Add Repository Pattern to `@nojv/db`

Wrap Prisma client in repository objects. After this phase, `prisma` is no longer exported.

### Task 3.1: Create repository files

**Files:**
- Create: `packages/db/src/repositories/submission.ts`
- Create: `packages/db/src/repositories/contest.ts`
- Create: `packages/db/src/repositories/problem.ts`
- Create: `packages/db/src/repositories/course.ts`
- Create: `packages/db/src/repositories/assessment.ts`
- Create: `packages/db/src/repositories/user.ts`
- Create: `packages/db/src/repositories/editorial.ts`
- Create: `packages/db/src/repositories/plagiarism.ts`
- Create: `packages/db/src/repositories/announcement.ts`
- Create: `packages/db/src/repositories/index.ts`

For each repository, audit ALL Prisma calls in `apps/web/src/lib/server/` and `packages/temporal/src/activities/` for that domain entity. Each unique Prisma query becomes a repository method.

**Approach:** Start by reading each domain file in `apps/web/src/lib/server/` and `packages/temporal/src/activities/`, extract every `prisma.xxx.yyy()` call, and create a corresponding repo method. Repository methods should accept the same parameters and return the same Prisma types (no DTO mapping yet — that's the domain layer's job).

**Example: `packages/db/src/repositories/submission.ts`**

Audit these source files for `prisma.submission.*` calls:
- `apps/web/src/lib/server/submission/queries.ts`
- `apps/web/src/lib/server/submission/mutations.ts`
- `packages/temporal/src/activities/judge.ts`
- `packages/temporal/src/activities/stats.ts`
- `packages/temporal/src/activities/contest.ts`

```typescript
import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";

export const submissionRepo = {
  findById(id: string) {
    return prisma.submission.findUnique({ where: { id } });
  },

  findByIdOrThrow(id: string) {
    return prisma.submission.findUniqueOrThrow({ where: { id } });
  },

  findByIdWithProblem(id: string) {
    return prisma.submission.findUnique({
      where: { id },
      include: {
        problem: {
          include: {
            templates: true,
            testcaseSets: {
              include: { testcases: { orderBy: { createdAt: "asc" } } },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    });
  },

  create(data: Prisma.SubmissionCreateInput) {
    return prisma.submission.create({ data });
  },

  updateStatus(id: string, data: Prisma.SubmissionUpdateInput) {
    return prisma.submission.update({ where: { id }, data });
  },

  findByUser(userId: string, opts?: { take?: number }) {
    return prisma.submission.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: opts?.take,
    });
  },

  findByContest(contestParticipationId: string) {
    return prisma.submission.findMany({
      where: { contestParticipationId, sampleOnly: false },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true, problemId: true, score: true, status: true },
    });
  },

  countAc(userId: string, problemId: string) {
    return prisma.submission.count({
      where: { userId, problemId, status: "accepted", sampleOnly: false },
    });
  },

  // Add more methods as discovered during audit
};
```

**Important:** This is an iterative process. During Phase 4 (domain creation), you'll discover additional queries that need repo methods. Add them as needed.

**Pattern for all repositories:**
1. Read the current Prisma calls for that entity
2. Create a method for each unique query pattern
3. Use descriptive method names (not just `findMany`)
4. Accept the same params, return the same Prisma result types
5. Keep `Prisma.XxxCreateInput` types for create/update methods

For `contest`, `course`, `problem`, `assessment`, `user`, `editorial`, `plagiarism`, `announcement` — follow the same pattern. Read the corresponding files in `apps/web/src/lib/server/` and `packages/temporal/src/activities/` to discover all queries.

### Task 3.2: Create repositories index and update package exports

**Files:**
- Create: `packages/db/src/repositories/index.ts`
- Modify: `packages/db/src/index.ts`

**repositories/index.ts:**
```typescript
export { submissionRepo } from "./submission";
export { contestRepo } from "./contest";
export { problemRepo } from "./problem";
export { courseRepo } from "./course";
export { assessmentRepo } from "./assessment";
export { userRepo } from "./user";
export { editorialRepo } from "./editorial";
export { plagiarismRepo } from "./plagiarism";
export { announcementRepo } from "./announcement";
```

**index.ts** — add repo exports, keep prisma export temporarily:
```typescript
import type { Prisma } from "../generated/prisma/client";

// Repositories (preferred access method)
export * from "./repositories";

// Legacy: will be removed after all consumers migrate to repositories
export * from "./client";
export * from "./env";
export type { Prisma };
export type TransactionClient = Prisma.TransactionClient;
```

Note: We keep `prisma` export temporarily. It will be removed after Phase 4 when all consumers are migrated.

### Task 3.3: Handle transactions

Some domain operations use `prisma.$transaction()`. Repositories need to support this.

**Add to each repository that needs transactions:**

```typescript
import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";

type TxClient = Prisma.TransactionClient;

export const submissionRepo = {
  // ... regular methods use module-level prisma

  // Transaction support: pass tx client
  withTx(tx: TxClient) {
    return {
      create(data: Prisma.SubmissionCreateInput) {
        return tx.submission.create({ data });
      },
      // ... same methods but using tx instead of prisma
    };
  },
};
```

Also export a transaction runner:
```typescript
// packages/db/src/transaction.ts
import { prisma } from "./client";
import type { Prisma } from "../generated/prisma/client";

export type TransactionClient = Prisma.TransactionClient;

export function runTransaction<T>(
  fn: (tx: TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(fn);
}
```

Add to `packages/db/src/index.ts`:
```typescript
export { runTransaction, type TransactionClient } from "./transaction";
```

### Task 3.4: Build and verify

Run: `cd packages/db && pnpm build && pnpm typecheck`

### Task 3.5: Commit

```bash
git add packages/db/src/repositories/ packages/db/src/transaction.ts packages/db/src/index.ts
git commit -m "feat: add repository pattern to @nojv/db"
```

---

## Phase 4: Create `@nojv/domain` Package

This is the largest phase. Move ALL business logic from `apps/web/src/lib/server/` into `@nojv/domain`.

### Task 4.1: Scaffold `@nojv/domain` package

**Files:**
- Create: `packages/domain/package.json`
- Create: `packages/domain/tsconfig.json`

**package.json:**
```json
{
  "name": "@nojv/domain",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./dist/index.mjs"
    }
  },
  "scripts": {
    "build": "tsdown",
    "lint": "eslint .",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@nojv/core": "workspace:*",
    "@nojv/db": "workspace:*",
    "@nojv/redis": "workspace:*",
    "@nojv/job-dispatch": "workspace:*",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "tsdown": "^0.21.2"
  }
}
```

Run: `pnpm install`

### Task 4.2: Create shared domain utilities

**Files:**
- Create: `packages/domain/src/shared/errors.ts`
- Create: `packages/domain/src/shared/permissions.ts`

**errors.ts** — move from `apps/web/src/lib/server/auth.ts:14-40`:
```typescript
export class HttpError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = this.constructor.name;
  }
}
export class NotFoundError extends HttpError {
  constructor(message = "Not found.") { super(message, 404); }
}
export class ConflictError extends HttpError {
  constructor(message = "Resource already exists.") { super(message, 409); }
}
export class ForbiddenError extends HttpError {
  constructor(message = "Forbidden.") { super(message, 403); }
}
```

**permissions.ts** — move from `apps/web/src/lib/server/shared/permissions.ts` (full file):
```typescript
import type { CourseRole, EffectiveCourseRole, PlatformRole } from "@nojv/core";

export function resolveEffectiveCourseRole(
  platformRole: PlatformRole, courseRole: CourseRole | null
): EffectiveCourseRole | null {
  if (platformRole === "admin") return "admin";
  return courseRole;
}

export function canManageCourse(effectiveRole: EffectiveCourseRole | null): boolean {
  return effectiveRole === "admin" || effectiveRole === "teacher" || effectiveRole === "ta";
}

export function canEditProblem(platformRole: PlatformRole): boolean {
  return platformRole === "admin" || platformRole === "teacher";
}
```

### Task 4.3: Create domain modules — one per domain

For each domain, move the corresponding files from `apps/web/src/lib/server/`:

| Domain module | Source files to move |
|---|---|
| `packages/domain/src/problem/` | `apps/web/src/lib/server/problem/queries.ts`, `mutations.ts`, `editorial-queries.ts` |
| `packages/domain/src/submission/` | `apps/web/src/lib/server/submission/queries.ts`, `mutations.ts` |
| `packages/domain/src/contest/` | `apps/web/src/lib/server/contest/queries.ts`, `mutations.ts`, `scoreboard.ts`, `schemas.ts` |
| `packages/domain/src/course/` | `apps/web/src/lib/server/course/queries.ts`, `mutations.ts`, `progress.ts` |
| `packages/domain/src/user/` | `apps/web/src/lib/server/user/mutations.ts` |
| `packages/domain/src/shared/` | `ip-utils.ts`, `page-lock.ts`, `permissions.ts`, errors |

**Migration procedure for each domain module:**

1. Copy the source file into `packages/domain/src/<domain>/`
2. Replace all `import { prisma } from "@nojv/db"` with repository imports: `import { submissionRepo } from "@nojv/db"`
3. Replace all direct `prisma.xxx.yyy()` calls with `xxxRepo.yyy()` calls
4. Replace Redis imports: `import { setCooldown } from "$lib/server/redis"` → `import { cooldown } from "@nojv/redis"`
5. Replace queue imports: `import { dispatchSubmissionJob } from "$lib/server/queue"` → `import { submitJudge } from "@nojv/job-dispatch"`
6. Replace error imports: `import { NotFoundError } from "$lib/server/auth"` → `import { NotFoundError } from "../shared/errors"`
7. Replace permission imports similarly
8. Remove any SvelteKit-specific imports (`@sveltejs/kit`, `RequestEvent`). If a function takes `RequestEvent`, split it: extract the business logic part into domain, leave the SvelteKit adapter in web.
9. Add repository methods to `@nojv/db` as needed for queries not yet covered

**Critical: SvelteKit dependency removal**

Some functions in `apps/web/src/lib/server/` use SvelteKit types (e.g., `redirect()`, `RequestEvent`). These CANNOT move to domain. Split them:

- **Domain function** (in `@nojv/domain`): Pure business logic, takes plain params, returns DTO
- **Adapter function** (stays in `apps/web`): Extracts params from SvelteKit types, calls domain, handles redirect/error

Example split for `requireAuth`:
```typescript
// @nojv/domain — does not exist, this is a web-only concern
// requireAuth stays in apps/web, but calls domain for permission checks

// apps/web/src/lib/server/auth.ts (stays here, but simplified)
import { resolveEffectiveCourseRole, canManageCourse } from "@nojv/domain";
import { redirect } from "@sveltejs/kit";
// ... SvelteKit-specific guards stay here
```

### Task 4.4: Create domain index

**Files:**
- Create: `packages/domain/src/index.ts`

```typescript
export * as problemDomain from "./problem";
export * as submissionDomain from "./submission";
export * as contestDomain from "./contest";
export * as courseDomain from "./course";
export * as userDomain from "./user";

export * from "./shared/errors";
export * from "./shared/permissions";
```

Each domain module has its own `index.ts` that re-exports queries and commands:
```typescript
// packages/domain/src/problem/index.ts
export * from "./queries";
export * from "./mutations";
export * from "./editorial-queries";
```

### Task 4.5: Build and verify

Run: `cd packages/domain && pnpm build && pnpm typecheck`

Fix any type errors. Most will be:
- Missing repository methods → add to `@nojv/db`
- SvelteKit imports → split function, keep adapter in web
- TransactionClient usage → use `runTransaction` from `@nojv/db`

### Task 4.6: Update web app to use `@nojv/domain`

**Files:**
- Modify: `apps/web/package.json` — add `@nojv/domain`, keep `@nojv/core`
- Modify: ALL files in `apps/web/src/lib/server/` that had business logic
- Modify: ALL SvelteKit route files (`+page.server.ts`, `+server.ts`) that imported from `$lib/server/<domain>/`

**Pattern:**
```typescript
// Before (in +page.server.ts):
import { listProblemCards } from "$lib/server/problem/queries";

// After:
import { problemDomain } from "@nojv/domain";
// ... use problemDomain.listProblemCards()
```

For files in `apps/web/src/lib/server/` that were moved to domain:
- Delete the file if ALL logic moved
- Keep it as thin adapter if some SvelteKit-specific code remains
- Update imports in the adapter to use `@nojv/domain`

### Task 4.7: Build, typecheck, verify

Run: `pnpm build && pnpm lint`

### Task 4.8: Commit

```bash
git add packages/domain/ packages/db/src/repositories/ apps/web/
git commit -m "refactor: create @nojv/domain package, move business logic from web"
```

---

## Phase 5: Refactor Temporal Activities to Use Domain

Update activities that directly access Prisma to call `@nojv/domain` data functions instead.

### Task 5.1: Update `@nojv/temporal` dependencies

**Files:**
- Modify: `packages/temporal/package.json` — add `@nojv/domain`, remove `@nojv/db`

```json
"dependencies": {
  "@nojv/core": "workspace:*",
  "@nojv/domain": "workspace:*",
  "@nojv/redis": "workspace:*",
  "@temporalio/activity": "^1.11.7",
  "@temporalio/client": "^1.11.7",
  "@temporalio/common": "^1.11.7",
  "@temporalio/workflow": "^1.11.7",
  "zod": "^4.3.6"
}
```

Note: `ioredis` removed (now in `@nojv/redis`). `@nojv/db` removed (accessed through `@nojv/domain`).

### Task 5.2: Refactor `assessment.ts` activities

**Files:**
- Modify: `packages/temporal/src/activities/assessment.ts`

```typescript
import { assessmentDomain } from "@nojv/domain";

// Types stay the same
export interface AssessmentInfo { closesAt: string; dueAt: string; opensAt: string; }

export async function getAssessmentInfo(assessmentId: string): Promise<AssessmentInfo> {
  return assessmentDomain.getAssessmentInfo(assessmentId);
}

export async function activateAssessment(assessmentId: string): Promise<void> {
  await assessmentDomain.activate(assessmentId);
}

export async function closeAssessment(assessmentId: string): Promise<void> {
  await assessmentDomain.close(assessmentId);
}
```

Corresponding domain functions needed in `packages/domain/src/assessment/`:
- `getAssessmentInfo(id)` — wraps `assessmentRepo.findById()`, returns ISO strings
- `activate(id)` — wraps `assessmentRepo.updateStatus(id, "published")`
- `close(id)` — wraps `assessmentRepo.updateStatus(id, "archived")`

### Task 5.3: Refactor `contest.ts` activities

**Files:**
- Modify: `packages/temporal/src/activities/contest.ts`

Replace all `prisma.*` calls with domain function calls:
- `getContestInfo()` → `contestDomain.getContestInfo()`
- `activateContest()` → `contestDomain.activate()`
- `freezeScoreboard()` → `contestDomain.freezeBoard()` (uses domain which calls both repo + `@nojv/redis/scoreboard`)
- `finalizeContest()` → `contestDomain.finalize()` (same pattern)
- `updateContestScores()` → `contestDomain.updateScores()` (ICPC/IOI scoring logic moves to domain)

The `updateContestScores()` function contains significant business logic (ICPC/IOI scoring). This MUST move to domain:

```typescript
// packages/domain/src/contest/scoring.ts — moved from activities/contest.ts:64-157
export async function updateContestScores(contestParticipationId: string): Promise<void> {
  // Same ICPC/IOI logic but using contestRepo, submissionRepo, and @nojv/redis/scoreboard
}
```

### Task 5.4: Refactor `judge.ts` activities

**Files:**
- Modify: `packages/temporal/src/activities/judge.ts`

This is the most complex activity file (464 lines). Split into:
- **Domain functions** (business logic → `@nojv/domain`):
  - `fetchJudgeContext()` → `problemDomain.getJudgeContext(submissionId)` (the complex Prisma query with deep includes)
  - `completeSubmission()` → `submissionDomain.complete(submissionId, result)` (write verdict + publish event)
  - `fetchSubmissionIdsForRejudge()` → `submissionDomain.findForRejudge(input)`
- **Activity functions** (orchestration, stays in temporal):
  - `executeSandbox()` — uses injected `SandboxExecutor`, builds `SandboxRequest`. The sandbox execution itself is NOT business logic. BUT the `mapResult()` helper that maps `SandboxResult` → `SubmissionResult` IS business logic.
  - Keep `setExecutor()`/`getExecutor()` in the activity file

**Split plan for `judge.ts`:**

Move to `packages/domain/src/submission/judge-context.ts`:
- `fetchJudgeContext()` function body (Prisma query + data shaping)
- `SubmissionJudgeContext` type
- `TestcaseSetGroup` type

Move to `packages/domain/src/submission/complete.ts`:
- `completeSubmission()` function body (DB update)
- `CompletedSubmission` type

Move to `packages/domain/src/submission/result-mapper.ts`:
- `mapResult()` helper
- `buildSubtaskResults()` helper

Keep in `packages/temporal/src/activities/judge.ts`:
- `executeSandbox()` — calls domain for result mapping, uses executor for sandbox
- `setExecutor()`/`getExecutor()`
- Re-export types from domain

### Task 5.5: Refactor `stats.ts` activities

**Files:**
- Modify: `packages/temporal/src/activities/stats.ts`

Move the entire `updateUserStats()` logic to `packages/domain/src/user/stats.ts`:

```typescript
// packages/domain/src/user/stats.ts
import { userRepo, submissionRepo, problemRepo, runTransaction } from "@nojv/db";
// ... same logic from temporal/activities/stats.ts but using repos
```

Activity becomes:
```typescript
import { userDomain } from "@nojv/domain";

export async function updateUserStats(submission: { ... }): Promise<void> {
  await userDomain.updateStats(submission);
}
```

### Task 5.6: Refactor `plagiarism.ts` activities

**Files:**
- Modify: `packages/temporal/src/activities/plagiarism.ts`

The MOSS client logic (socket protocol) is infrastructure, but the DB queries (fetch submissions, update report) are business logic.

Move to `packages/domain/src/plagiarism/`:
- `fetchSubmissionsForCheck(targetId, targetType)` — the Prisma query
- `updateReportStatus(reportId, status)` — status updates
- `saveResults(reportId, results)` — save pairs

Keep in activity:
- MOSS socket connection and protocol handling (infrastructure)
- But call domain for DB operations

### Task 5.7: Update activity bundles

**Files:**
- Modify: `packages/temporal/src/activities/index.ts`
- Modify: `packages/temporal/src/activities/judge-bundle.ts`
- Modify: `packages/temporal/src/activities/platform-bundle.ts`

These should still export the same function signatures. The internal implementation changed (delegating to domain) but the public API is unchanged. Verify all exports still work.

### Task 5.8: Build, typecheck, verify

Run: `pnpm build && pnpm lint`

### Task 5.9: Commit

```bash
git add packages/temporal/ packages/domain/
git commit -m "refactor: temporal activities delegate to @nojv/domain"
```

---

## Phase 6: Cleanup and Hardening

### Task 6.1: Remove `prisma` export from `@nojv/db`

**Files:**
- Modify: `packages/db/src/index.ts`

```typescript
// Remove these lines:
// export * from "./client";
// Keep repositories and transaction runner only

export * from "./repositories";
export { runTransaction, type TransactionClient } from "./transaction";
export * from "./env";
export type { Prisma } from "../generated/prisma/client";
```

Run: `pnpm build` — any remaining direct `prisma` import will fail. Fix each one.

### Task 6.2: Add Submission CHECK constraint

**Files:**
- Create: new Prisma migration

```bash
cd packages/db && pnpm db:migrate --name add_submission_context_check
```

Then add to the generated migration SQL:

```sql
ALTER TABLE "Submission" ADD CONSTRAINT submission_context_check CHECK (
  CASE mode
    WHEN 'practice'   THEN "contestId" IS NULL AND "courseAssessmentId" IS NULL
    WHEN 'contest'    THEN "contestId" IS NOT NULL AND "courseAssessmentId" IS NULL
    WHEN 'assignment' THEN "courseAssessmentId" IS NOT NULL AND "contestId" IS NULL
  END
);
```

### Task 6.3: Remove dead code from web app

**Files:**
- Delete: `apps/web/src/lib/server/problem/queries.ts` (if fully moved to domain)
- Delete: `apps/web/src/lib/server/problem/mutations.ts` (if fully moved)
- Delete: `apps/web/src/lib/server/submission/queries.ts` (if fully moved)
- Delete: `apps/web/src/lib/server/submission/mutations.ts` (if fully moved)
- Delete: `apps/web/src/lib/server/contest/queries.ts` (if fully moved)
- Delete: `apps/web/src/lib/server/contest/mutations.ts` (if fully moved)
- Delete: `apps/web/src/lib/server/contest/scoreboard.ts` (if fully moved)
- Delete: `apps/web/src/lib/server/course/queries.ts` (if fully moved)
- Delete: `apps/web/src/lib/server/course/mutations.ts` (if fully moved)
- Delete: `apps/web/src/lib/server/course/progress.ts` (if fully moved)
- Delete: `apps/web/src/lib/server/user/mutations.ts` (if fully moved)
- Delete: `apps/web/src/lib/server/shared/permissions.ts` (moved to domain)

Keep in web (SvelteKit-specific):
- `auth.ts` — actor context extraction from `RequestEvent`, guards with `redirect()`
- `shared/api-handler.ts` — SvelteKit response formatting
- `shared/rate-limiter.ts` — app-specific config
- `shared/handle-action-error.ts` — SvelteKit error classification
- `shared/pick-problem-statement.ts` — UI presentation helper

### Task 6.4: Update web app dependency list

**Files:**
- Modify: `apps/web/package.json`

Remove dependencies no longer needed:
- `@nojv/temporal` — replaced by `@nojv/job-dispatch` (via domain)
- `ioredis` — replaced by `@nojv/redis` (via domain)

Verify `@nojv/domain` is listed. Remove `@nojv/db` if the web app no longer imports it directly (it shouldn't after full migration).

### Task 6.5: Verify dependency rules

Run a grep to verify no violations of the dependency rules:

```bash
# Web must NOT import db, redis, job-dispatch, temporal directly
grep -r "from \"@nojv/db\"" apps/web/src/ && echo "VIOLATION: web imports db"
grep -r "from \"@nojv/redis\"" apps/web/src/ && echo "VIOLATION: web imports redis"
grep -r "from \"@nojv/job-dispatch\"" apps/web/src/ && echo "VIOLATION: web imports job-dispatch"
grep -r "from \"@nojv/temporal\"" apps/web/src/ && echo "VIOLATION: web imports temporal"
grep -r "from \"ioredis\"" apps/web/src/ && echo "VIOLATION: web imports ioredis"

# Temporal must NOT import db directly
grep -r "from \"@nojv/db\"" packages/temporal/src/ && echo "VIOLATION: temporal imports db"

# Domain must NOT import temporal
grep -r "from \"@nojv/temporal\"" packages/domain/src/ && echo "VIOLATION: domain imports temporal"
```

All should return no matches (exit code 1).

### Task 6.6: Full build and lint

Run: `pnpm build && pnpm lint && pnpm typecheck`

### Task 6.7: Commit

```bash
git add -A
git commit -m "refactor: complete architecture migration, enforce dependency rules"
```

---

## Phase 7: Update Documentation

### Task 7.1: Update ARCHITECTURE.md

Already done in design phase. Verify it matches final implementation.

### Task 7.2: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

Update Repository Layout to reflect new packages:

```
packages/
  core/             Shared Zod schemas, types, pipeline definitions
  db/               Prisma 7 schema, migrations, repositories
  redis/            Redis connection, key registry, pub/sub, cache, cooldown
  job-dispatch/     Temporal client wrapper, workflow dispatch API
  temporal/         Temporal workflows, activities (thin wrappers over domain)
  domain/           Business logic — queries, commands, scoring, stats
```

### Task 7.3: Update related docs

**Files:**
- Modify: `docs/TEMPORAL.md` — note that activities now delegate to `@nojv/domain`
- Modify: `docs/REDIS.md` — note `@nojv/redis` package as the source of truth
- Modify: `docs/DATABASE.md` — note repository pattern, CHECK constraint

### Task 7.4: Commit

```bash
git add CLAUDE.md ARCHITECTURE.md docs/
git commit -m "docs: update documentation for new architecture"
```

---

## Execution Notes

### Order matters
Phases MUST be executed in order (1 → 2 → 3 → 4 → 5 → 6 → 7). Within each phase, tasks are sequential.

### Incremental verification
After each phase, run `pnpm build && pnpm lint`. Fix errors before proceeding.

### Repository method discovery
Phase 3 (repositories) will be iteratively expanded during Phase 4 (domain). When a domain function needs a query that doesn't exist yet in a repository, add it immediately.

### SvelteKit boundary
The hardest part is splitting functions that mix SvelteKit types with business logic. The rule: if it takes `RequestEvent` or calls `redirect()`, it stays in web. Extract the business logic into a domain function that takes plain params.

### Testing
After the migration is complete, run existing tests to verify no regressions:
```bash
pnpm test:unit
pnpm test:integration
```
