# Merge queue & sandbox packages into core

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate `@nojv/queue` and `@nojv/sandbox` packages by moving their schemas/types/constants into `@nojv/core`, and moving ioredis pubsub code into individual apps.

**Architecture:** All shared types/schemas/constants live in `@nojv/core`. Runtime server code (ioredis pubsub) moves to `apps/web/src/lib/server/redis.ts` and `apps/worker/src/services/redis.ts`. After migration, delete `packages/queue` and `packages/sandbox`.

**Tech Stack:** TypeScript, Zod, pnpm workspace, SvelteKit, ioredis

---

### Task 1: Add queue schemas/constants to core

Move `events.ts`, `names.ts`, `jobs.ts`, `connection.ts` content into core.

**Files:**
- Create: `packages/core/src/queue.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Create `packages/core/src/queue.ts`**

```typescript
import { z } from "zod";

import { submissionDraftSchema } from "./schemas/submission";

// --- SSE events ---

export const SSE_SUBMISSION_VERDICT = "submission:verdict" as const;
export const SSE_CONTEST_STARTING = "contest:starting" as const;
export const SSE_CONTEST_ENDING = "contest:ending" as const;
export const SSE_ASSIGNMENT_DEADLINE = "assignment:deadline" as const;

export function userChannel(userId: string): string {
  return `user:${userId}`;
}

const submissionVerdictEventSchema = z.object({
  type: z.literal(SSE_SUBMISSION_VERDICT),
  submissionId: z.string(),
  verdict: z.string(),
  score: z.number(),
  problemId: z.string(),
  problemSlug: z.string().nullable()
});

const contestStartingEventSchema = z.object({ type: z.literal(SSE_CONTEST_STARTING) });
const contestEndingEventSchema = z.object({ type: z.literal(SSE_CONTEST_ENDING) });
const assignmentDeadlineEventSchema = z.object({ type: z.literal(SSE_ASSIGNMENT_DEADLINE) });

export const sseEventSchema = z.discriminatedUnion("type", [
  submissionVerdictEventSchema,
  contestStartingEventSchema,
  contestEndingEventSchema,
  assignmentDeadlineEventSchema
]);

export type SubmissionVerdictEvent = z.infer<typeof submissionVerdictEventSchema>;
export type ContestStartingEvent = z.infer<typeof contestStartingEventSchema>;
export type ContestEndingEvent = z.infer<typeof contestEndingEventSchema>;
export type AssignmentDeadlineEvent = z.infer<typeof assignmentDeadlineEventSchema>;
export type SSEEvent = z.infer<typeof sseEventSchema>;

// --- Queue names ---

export const queueNames = {
  submission: "submission-judge",
  submissionDlq: "submission-judge-dlq"
} as const;

// --- Job schemas ---

export const defaultJobOptions = {
  attempts: 3,
  removeOnComplete: 250,
  removeOnFail: false
} as const;

export const submissionJudgeJobSchema = z.object({
  draft: submissionDraftSchema,
  submissionId: z.string().trim().min(1)
});

export type SubmissionJudgeJob = z.infer<typeof submissionJudgeJobSchema>;

// --- Redis connection ---

interface RedisConnectionOptions {
  host: string;
  maxRetriesPerRequest: null;
  password: string | undefined;
  port: number;
}

export function parseRedisConnection(redisUrl: string): RedisConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    maxRetriesPerRequest: null,
    password: url.password || undefined,
    port: Number(url.port || "6379")
  };
}
```

**Step 2: Add re-export to `packages/core/src/index.ts`**

Add this line at the end:
```typescript
export * from "./queue";
```

**Step 3: Verify**

Run: `pnpm --filter @nojv/core typecheck`

---

### Task 2: Add sandbox types/constants to core

Move all sandbox content into core.

**Files:**
- Create: `packages/core/src/sandbox.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Create `packages/core/src/sandbox.ts`**

```typescript
import type { JudgeType, Language, SubmissionType } from "./types";

// --- Sandbox request ---

export interface SandboxTestcase {
  index: number;
  input: string;
  expected?: string;
  weight: number;
  isSample: boolean;
}

export interface SandboxRequest {
  submissionId: string;
  sourceCode: string;
  language: Language;
  submissionType: SubmissionType;
  testcases: SandboxTestcase[];
  judgeType: JudgeType;
  judgeConfig: {
    checkerScript?: string;
    interactorScript?: string;
    checkerLanguage?: string;
    interactorLanguage?: string;
  };
  limits: {
    timeoutMs: number;
    memoryMb: number;
  };
  template?: {
    driverCode: string;
    insertionMarker: string;
  };
}

// --- Sandbox result ---

export const sandboxVerdicts = ["AC", "WA", "TLE", "MLE", "RE", "SE"] as const;
export type SandboxVerdict = (typeof sandboxVerdicts)[number];

export interface SandboxTestcaseResult {
  index: number;
  verdict: SandboxVerdict;
  stdout: string;
  stderr: string;
  exitCode: number;
  timeMs: number;
  score?: number;
  feedback?: string;
}

export interface SandboxResult {
  compilationError?: string;
  testcaseResults: SandboxTestcaseResult[];
}

export interface SandboxExecutor {
  execute(request: SandboxRequest): Promise<SandboxResult>;
}

// --- Language file mapping ---

export const sourceFileNames: Record<Language, string> = {
  c: "main.c",
  cpp: "main.cpp",
  go: "main.go",
  java: "Main.java",
  javascript: "main.mjs",
  python: "main.py",
  rust: "main.rs",
  typescript: "main.ts"
};

export const sourceExtensions: Record<Language, string> = {
  c: "c",
  cpp: "cpp",
  go: "go",
  java: "java",
  javascript: "mjs",
  python: "py",
  rust: "rs",
  typescript: "ts"
};
```

**Step 2: Add re-export to `packages/core/src/index.ts`**

Add this line at the end:
```typescript
export * from "./sandbox";
```

**Step 3: Verify**

Run: `pnpm --filter @nojv/core typecheck`

---

### Task 3: Move pubsub into apps

Create Redis pubsub helpers in web and worker apps.

**Files:**
- Create: `apps/web/src/lib/server/redis.ts`
- Create: `apps/worker/src/services/redis.ts`

**Step 1: Create `apps/web/src/lib/server/redis.ts`**

Only web needs `createSubscriber`:

```typescript
import Redis from "ioredis";
import { parseRedisConnection, type SSEEvent } from "@nojv/core";

export function createSubscriber(redisUrl: string): Redis {
  const opts = parseRedisConnection(redisUrl);
  return new Redis({ host: opts.host, port: opts.port, password: opts.password });
}
```

**Step 2: Create `apps/worker/src/services/redis.ts`**

Worker needs `createPublisher` and `publishEvent`:

```typescript
import Redis from "ioredis";
import { parseRedisConnection, type SSEEvent } from "@nojv/core";

export function createPublisher(redisUrl: string): Redis {
  const opts = parseRedisConnection(redisUrl);
  return new Redis({ host: opts.host, port: opts.port, password: opts.password });
}

export function publishEvent(
  publisher: Redis,
  channel: string,
  event: SSEEvent
): Promise<number> {
  return publisher.publish(channel, JSON.stringify(event));
}
```

**Step 3: Add ioredis dependency to `apps/web/package.json`**

Web currently gets ioredis transitively via @nojv/queue. After removing queue, web needs it directly.

Run: `pnpm --filter web add ioredis`

(Worker already has bullmq which depends on ioredis, but check if it needs a direct dep too.)

---

### Task 4: Update all imports in apps/web

Replace all `@nojv/queue` and `@nojv/queue/events` imports with `@nojv/core` or local redis.

**Files to modify (6 files):**

1. **`apps/web/src/lib/stores/sse.ts`** (CLIENT-SIDE)
   - Change: `from "@nojv/queue/events"` → `from "@nojv/core"`

2. **`apps/web/src/lib/components/problem/Workspace.svelte`** (CLIENT-SIDE)
   - Change: `from "@nojv/queue/events"` → `from "@nojv/core"`

3. **`apps/web/src/routes/api/events/stream/+server.ts`** (SERVER)
   - Change: `from "@nojv/queue/pubsub"` → `from "$lib/server/redis"`
   - Change: `from "@nojv/queue"` → `from "@nojv/core"`

4. **`apps/web/src/lib/server/queue.ts`** (SERVER)
   - Change: `from "@nojv/queue"` → `from "@nojv/core"`

5. **`apps/web/src/routes/(app)/admin/system/+page.server.ts`** (SERVER)
   - Change: `from "@nojv/queue"` → `from "@nojv/core"`

**Verify:** `pnpm --filter web typecheck`

---

### Task 5: Update all imports in apps/worker

Replace all `@nojv/queue` and `@nojv/sandbox` imports.

**Files to modify (5 files):**

1. **`apps/worker/src/worker-app.ts`**
   - Change: `from "@nojv/queue"` → `from "@nojv/core"`

2. **`apps/worker/src/services/judge-db.ts`**
   - Change: `from "@nojv/queue"` → `from "@nojv/core"`
   - Change: `from "@nojv/queue/pubsub"` → `from "./redis"`

3. **`apps/worker/src/processors/submission.ts`**
   - Change: `from "@nojv/queue"` → `from "@nojv/core"`

4. **`apps/worker/src/services/sandbox-schema.ts`**
   - Change: `from "@nojv/sandbox"` → `from "@nojv/core"`

5. **`apps/worker/src/services/k8s-executor.ts`**
   - Change: `from "@nojv/sandbox"` → `from "@nojv/core"`

6. **`apps/worker/src/services/docker-executor.ts`**
   - Change: `from "@nojv/sandbox"` → `from "@nojv/core"`

7. **`apps/worker/src/services/submission-runner.ts`**
   - Change: `from "@nojv/sandbox"` → `from "@nojv/core"`

8. **`apps/worker/src/services/executor-factory.ts`**
   - Change: `from "@nojv/sandbox"` → `from "@nojv/core"`

**Verify:** `pnpm --filter @nojv/worker typecheck`

---

### Task 6: Update all imports in apps/sandbox-runner

**Files to modify (2 files):**

1. **`apps/sandbox-runner/src/compiler.ts`**
   - Change: `from "@nojv/sandbox"` → `from "@nojv/core"`

2. **`apps/sandbox-runner/src/types.ts`**
   - Change: all `from "@nojv/sandbox"` → `from "@nojv/core"`

**Verify:** `pnpm --filter @nojv/sandbox-runner typecheck`

---

### Task 7: Update package.json dependencies

Remove `@nojv/queue` and `@nojv/sandbox` from all consumers. Add `@nojv/core` where missing.

**Files to modify:**

1. **`apps/web/package.json`**: Remove `"@nojv/queue": "workspace:*"`. Add `ioredis` (for pubsub).
2. **`apps/worker/package.json`**: Remove `"@nojv/queue": "workspace:*"` and `"@nojv/sandbox": "workspace:*"`.
3. **`apps/sandbox-runner/package.json`**: Remove `"@nojv/sandbox": "workspace:*"`. Add `"@nojv/core": "workspace:*"` if not present.

**Verify:** `pnpm install`

---

### Task 8: Update vitest config and Dockerfiles

**Files to modify:**

1. **`vitest.config.ts`**: Remove `"@nojv/queue"` alias from `sharedAliases`.

2. **`infra/docker/worker.Dockerfile`**: Remove `pnpm --filter @nojv/sandbox build` line.

3. **`infra/docker/sandbox-runner.Dockerfile`**: Change `pnpm --filter @nojv/sandbox build` to `pnpm --filter @nojv/core build`.

**Verify:** `pnpm test` (unit tests pass)

---

### Task 9: Delete old packages

**Step 1:** Delete `packages/queue/` directory.

**Step 2:** Delete `packages/sandbox/` directory.

**Step 3:** Run `pnpm install` to update lockfile.

**Step 4:** Full verification:
- `pnpm typecheck` (all packages)
- `pnpm test` (unit tests)
- `pnpm --filter web dev` and verify /courses loads without 500

---

### Task 10: Clean up hooks.server.ts debug logging

The debug `handleError` and `console.log` statements added during investigation should already be removed. Verify `apps/web/src/hooks.server.ts` is clean.

---

### Summary of changes

**Before:**
```
packages/core/     → types, schemas
packages/db/       → Prisma client
packages/queue/    → queue schemas + ioredis pubsub (⚠️ leaks to client)
packages/sandbox/  → sandbox types
```

**After:**
```
packages/core/     → types, schemas, queue constants, sandbox types
packages/db/       → Prisma client
(deleted)          ← queue
(deleted)          ← sandbox
apps/web/src/lib/server/redis.ts    ← createSubscriber (from pubsub)
apps/worker/src/services/redis.ts   ← createPublisher, publishEvent (from pubsub)
```
