# Packages Refactor: Merge domain+queue → core, Clean Up db

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate 3 packages into 2 (`@nojv/core` + `@nojv/db`), delete dead code, eliminate type duplication between worker and sandbox-runner.

**Architecture:** Merge `@nojv/domain` + `@nojv/queue` into `@nojv/core`. Add shared sandbox contract types. Strip `@nojv/db` down to Prisma client + env only. Move worker-specific DB functions into the worker app. Delete all unused workspace-run and cheating-case code from db.

**Tech Stack:** TypeScript, Zod v4, Prisma, tsdown, pnpm workspaces, Turbo

---

## Before/After Package Structure

```
BEFORE:                              AFTER:
packages/                            packages/
  domain/  (637 lines, schemas)        core/  (domain + queue + sandbox contract)
  db/      (423 lines, prisma+judge)   db/    (prisma client + env only)
  queue/   (44 lines, queue defs)
```

## Import Migration Map

| Old import | New import |
|---|---|
| `from "@nojv/domain"` | `from "@nojv/core"` |
| `from "@nojv/queue"` | `from "@nojv/core"` |
| `createSubmissionJob` / `QueueEnvelope` | **DELETED** (use `queueNames` + `defaultJobOptions` directly) |
| `getSubmissionOperation` from `@nojv/db` | Inline `prisma.submission.findUnique(...)` |
| `completeSubmission` etc from `@nojv/db` | `from "../services/judge-db.js"` (worker-local) |
| `SandboxRequest`/`SandboxResult` (worker local) | `from "@nojv/core"` |
| `SandboxInput`/`SandboxOutput` (sandbox-runner local) | `from "@nojv/core"` |

---

### Task 1: Green Baseline

**Step 1: Run full build + tests**

```bash
cd /Users/takala/code/NOJV
pnpm build && pnpm test
```

Expected: All pass. If not, fix before proceeding.

---

### Task 2: Create `@nojv/core` Package Scaffold

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/tsdown.config.ts`
- Create: `packages/core/eslint.config.mjs`

**Step 1: Create package.json**

```json
{
  "name": "@nojv/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsdown",
    "lint": "eslint .",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "tsdown": "^0.12.5"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "."
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

**Step 3: Create tsdown.config.ts**

```ts
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  clean: true
});
```

**Step 4: Create eslint.config.mjs**

Copy from `packages/domain/eslint.config.mjs` (should be a simple re-export of root config).

---

### Task 3: Populate `@nojv/core` Source Files

**Files:**
- Create: `packages/core/src/index.ts`
- Create: `packages/core/src/domain.ts`
- Create: `packages/core/src/queue.ts`
- Create: `packages/core/src/sandbox.ts`

**Step 1: Create `src/domain.ts`**

Copy the entire content of `packages/domain/src/index.ts` (637 lines) to `packages/core/src/domain.ts`.

Then apply one simplification — replace `problemUpdateSchema` (lines 149-165) with:

```ts
export const problemUpdateSchema = problemCreateSchema.omit({ slug: true }).partial();
```

This replaces 16 lines of duplicated field definitions with 1 line. The behavior is identical: all fields except `slug` become optional.

Also export the type:
```ts
export type ProblemUpdate = z.infer<typeof problemUpdateSchema>;
```

(This line already exists later in the file — keep it as-is.)

**Step 2: Create `src/queue.ts`**

Simplified queue constants — no `QueueEnvelope`, no factory functions:

```ts
import { submissionDraftSchema, type CheatingSignal } from "./domain";
import { z } from "zod";

export const queueNames = {
  cheatingSignal: "cheating-signal",
  submission: "submission-judge"
} as const;

export const defaultJobOptions = {
  attempts: 3,
  removeOnComplete: 250,
  removeOnFail: 500
} as const;

export const submissionJudgeJobSchema = z.object({
  draft: submissionDraftSchema,
  submissionId: z.string().trim().min(1)
});

export type SubmissionJudgeJob = z.infer<typeof submissionJudgeJobSchema>;
```

Note: `CheatingSignal` type is already exported from `domain.ts` — no need to re-export here.

**Step 3: Create `src/sandbox.ts`**

Shared sandbox contract types (replaces duplicated types in worker + sandbox-runner):

```ts
import type { JudgeType, Language, SubmissionType } from "./domain";

export const sandboxVerdicts = ["AC", "WA", "TLE", "MLE", "RE", "SE"] as const;
export type SandboxVerdict = (typeof sandboxVerdicts)[number];

export interface SandboxConfig {
  submissionId: string;
  language: Language;
  judgeType: JudgeType;
  submissionType: SubmissionType;
  limits: {
    timeoutMs: number;
    memoryMb: number;
  };
  template?: {
    driverCode: string;
    insertionMarker: string;
  };
  checkerLanguage?: string;
  interactorLanguage?: string;
}

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

**Step 4: Create `src/index.ts`**

Barrel re-export:

```ts
export * from "./domain";
export * from "./queue";
export * from "./sandbox";
```

**Step 5: Verify build**

```bash
cd /Users/takala/code/NOJV/packages/core
pnpm install && pnpm build
```

---

### Task 4: Move Tests to `@nojv/core`

**Files:**
- Create: `packages/core/tests/schemas.test.ts` (copy from domain)
- Create: `packages/core/tests/session-identifiers.test.ts` (copy from domain)
- Create: `packages/core/tests/course-schemas.test.ts` (copy from domain)
- Create: `packages/core/tests/queue-contracts.test.ts` (adapted from queue)

**Step 1: Copy domain tests**

Copy all 3 test files from `packages/domain/tests/` to `packages/core/tests/`. Update import paths:

```ts
// Change all occurrences of:
import { ... } from "../src/index";
// To:
import { ... } from "../src/index";
// (Same path — these tests reference relative to package root, should work as-is)
```

**Step 2: Adapt queue contract test**

Copy `packages/queue/tests/contracts.test.ts` to `packages/core/tests/queue-contracts.test.ts`.

Remove tests for `createSubmissionJob` and `createCheatingSignalJob` (deleted). Keep tests for `queueNames` and `submissionJudgeJobSchema`. Update imports from `"../src/index"`.

Simplified test file:

```ts
import { describe, expect, it } from "vitest";
import { queueNames, submissionJudgeJobSchema } from "../src/index";

describe("queue contracts", () => {
  it("uses explicit queue names for dashboard routing", () => {
    expect(queueNames.submission).toBe("submission-judge");
    expect(queueNames.cheatingSignal).toBe("cheating-signal");
  });

  it("validates submission job payload", () => {
    const result = submissionJudgeJobSchema.safeParse({
      submissionId: "sub-123",
      draft: {
        mode: "practice",
        problemSlug: "two-sum",
        language: "python",
        sourceCode: "print('hello')"
      }
    });
    expect(result.success).toBe(true);
  });
});
```

**Step 3: Run core tests**

```bash
cd /Users/takala/code/NOJV/packages/core
pnpm test
```

Expected: All pass.

**Step 4: Commit**

```bash
git add packages/core/
git commit -m "feat: create @nojv/core package (merged domain + queue + sandbox contract)"
```

---

### Task 5: Update Web App Imports

**Files to modify** (all `@nojv/domain` → `@nojv/core`):

1. `apps/web/src/lib/types.ts`
2. `apps/web/src/lib/server/auth.ts`
3. `apps/web/src/lib/server/db.ts`
4. `apps/web/src/lib/server/queries.ts`
5. `apps/web/src/lib/auth.ts`
6. `apps/web/src/routes/api/submissions/+server.ts`
7. `apps/web/src/routes/courses/+page.server.ts`
8. `apps/web/src/routes/courses/[slug]/join/[token]/+page.server.ts`
9. `apps/web/src/routes/courses/[slug]/manage/members/+page.server.ts`
10. `apps/web/src/routes/courses/[slug]/manage/problems/+page.server.ts`
11. `apps/web/src/routes/courses/[slug]/manage/assessments/+page.server.ts`
12. `apps/web/src/routes/problems/[slug]/edit/+page.server.ts`
13. `apps/web/src/routes/problems/create/+page.server.ts`

**Step 1: Find-and-replace `@nojv/domain` → `@nojv/core`**

In every file listed above, change:
```ts
from "@nojv/domain"
```
to:
```ts
from "@nojv/core"
```

No other changes needed — all named exports remain the same.

**Step 2: Update `apps/web/src/lib/server/queue.ts`**

Replace the entire file with simplified version (removes `createSubmissionJob` and `QueueEnvelope` usage):

```ts
import { Queue } from "bullmq";
import {
  defaultJobOptions,
  queueNames,
  submissionJudgeJobSchema,
  type SubmissionJudgeJob
} from "@nojv/core";
import { z } from "zod";

const queueEnvSchema = z.object({
  REDIS_URL: z.url().default("redis://localhost:6379")
});

interface QueueRegistry {
  queues: {
    submission: Queue<SubmissionJudgeJob>;
  };
}

const environment = queueEnvSchema.parse(process.env);
const redis = new URL(environment.REDIS_URL);
const connection = {
  host: redis.hostname,
  maxRetriesPerRequest: null,
  password: redis.password || undefined,
  port: Number(redis.port || "6379")
};

const globalForQueues = globalThis as typeof globalThis & {
  __nojvQueueRegistry?: QueueRegistry;
};

function createQueueRegistry(): QueueRegistry {
  return {
    queues: {
      submission: new Queue(queueNames.submission, { connection })
    }
  };
}

function getQueueRegistry() {
  globalForQueues.__nojvQueueRegistry ??= createQueueRegistry();

  return globalForQueues.__nojvQueueRegistry;
}

export async function dispatchSubmissionJob(payload: SubmissionJudgeJob): Promise<void> {
  const validated = submissionJudgeJobSchema.parse(payload);
  const registry = getQueueRegistry();

  await registry.queues.submission.add(queueNames.submission, validated, defaultJobOptions);
}
```

Key change: `dispatchSubmissionJob` no longer uses `createSubmissionJob` envelope. It validates directly and calls `queue.add()` with the validated data.

**Step 3: Inline `getSubmissionOperation` in web route**

Modify `apps/web/src/routes/api/submissions/[submissionId]/+server.ts`:

```ts
import { prisma } from "@nojv/db";
import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { getActorContext, hasActorHandle, HttpError, NotFoundError } from "$lib/server/auth";

export const GET: RequestHandler = async (event) => {
  try {
    const actor = getActorContext(event);
    if (!actor) return json({ message: "Authentication required." }, { status: 401 });
    if (!hasActorHandle(actor)) return json({ message: "Complete your profile first." }, { status: 403 });

    const submissionId = event.params.submissionId;
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId }
    });

    if (!submission) {
      throw new NotFoundError("Submission not found.");
    }

    if (submission.userId !== actor.userId && actor.platformRole !== "admin") {
      throw new NotFoundError("Submission not found.");
    }

    return json({
      result: submission.verdictDetail,
      status: submission.status,
      submissionId: submission.id
    });
  } catch (error) {
    if (error instanceof HttpError) return json({ message: error.message }, { status: error.status });
    console.error("Unhandled error:", error);
    return json({ message: "Internal server error." }, { status: 500 });
  }
};
```

Change: `import { getSubmissionOperation } from "@nojv/db"` → `import { prisma } from "@nojv/db"`, then use `prisma.submission.findUnique()` directly.

**Step 4: Update `apps/web/package.json`**

Replace `@nojv/domain` and `@nojv/queue` with `@nojv/core`:

```json
"dependencies": {
  "@nojv/core": "workspace:*",
  "@nojv/db": "workspace:*",
  // ... rest unchanged
}
```

Remove `"@nojv/domain": "workspace:*"` and `"@nojv/queue": "workspace:*"`.

**Step 5: Verify web builds**

```bash
cd /Users/takala/code/NOJV
pnpm install && pnpm --filter @nojv/web typecheck
```

**Step 6: Commit**

```bash
git add apps/web/ packages/core/
git commit -m "refactor: migrate web app from @nojv/domain + @nojv/queue to @nojv/core"
```

---

### Task 6: Update Worker App

**Files to modify:**
- Modify: `apps/worker/src/worker-app.ts`
- Modify: `apps/worker/src/processors/submission.ts`
- Modify: `apps/worker/src/processors/cheating-signal.ts`
- Modify: `apps/worker/src/services/submission-runner.ts`
- Modify: `apps/worker/src/services/docker-executor.ts`
- Modify: `apps/worker/src/services/k8s-executor.ts`
- Create: `apps/worker/src/services/judge-db.ts`
- Delete: `apps/worker/src/services/sandbox-executor.ts`
- Modify: `apps/worker/package.json`

**Step 1: Create `apps/worker/src/services/judge-db.ts`**

Move worker-specific DB operations from `packages/db/src/judge-operations.ts`:

```ts
import { prisma } from "@nojv/db";
import type { ProblemJudgeTestcase, SubmissionResult } from "@nojv/core";

type PersistedSubmissionStatus =
  | "accepted"
  | "compile_error"
  | "memory_limit_exceeded"
  | "queued"
  | "running"
  | "runtime_error"
  | "time_limit_exceeded"
  | "wrong_answer";

function mapSubmissionResultToStatus(result: SubmissionResult): PersistedSubmissionStatus {
  switch (result.verdict) {
    case "accepted":
      return "accepted";
    case "compile_error":
      return "compile_error";
    case "runtime_error":
      return "runtime_error";
    case "time_limit_exceeded":
      return "time_limit_exceeded";
    case "memory_limit_exceeded":
      return "memory_limit_exceeded";
    case "wrong_answer":
      return "wrong_answer";
  }
}

export async function markSubmissionRunning(submissionId: string) {
  return prisma.submission.update({
    data: { status: "running" },
    where: { id: submissionId }
  });
}

export async function completeSubmission(submissionId: string, result: SubmissionResult) {
  return prisma.submission.update({
    data: {
      compilerOutput: result.verdict === "compile_error" ? result.feedback : null,
      runtimeMs: result.runtimeMs,
      score: result.score,
      status: mapSubmissionResultToStatus(result),
      verdictDetail: result
    },
    where: { id: submissionId }
  });
}

export interface SubmissionJudgeContext {
  checkerScript: string | null;
  interactorScript: string | null;
  judgeType: "standard" | "checker" | "interactive";
  memoryLimitMb: number;
  problemSlug: string;
  submissionType: "function" | "full_source";
  templates: {
    driverCode: string;
    insertionMarker: string;
    language: string;
    templateCode: string;
  }[];
  testcases: ProblemJudgeTestcase[];
  timeLimitMs: number;
}

export async function getSubmissionJudgeContext(
  submissionId: string
): Promise<SubmissionJudgeContext | null> {
  const submission = await prisma.submission.findUnique({
    include: {
      problem: {
        include: {
          templates: true,
          testcaseSets: {
            include: {
              testcases: { orderBy: { ordinal: "asc" } }
            },
            orderBy: { createdAt: "asc" }
          }
        }
      }
    },
    where: { id: submissionId }
  });

  if (!submission) return null;

  return {
    checkerScript: submission.problem.checkerScript,
    interactorScript: submission.problem.interactorScript,
    judgeType: submission.problem.judgeType,
    memoryLimitMb: submission.problem.memoryLimitMb,
    problemSlug: submission.problem.slug,
    submissionType: submission.problem.submissionType,
    templates: submission.problem.templates.map((t) => ({
      driverCode: t.driverCode,
      insertionMarker: t.insertionMarker,
      language: t.language,
      templateCode: t.templateCode
    })),
    testcases: submission.problem.testcaseSets.flatMap((testcaseSet) =>
      testcaseSet.testcases.map((testcase) => ({
        expectedStdout: testcase.expectedStdout ?? undefined,
        id: testcase.id,
        inputFiles: (testcase.inputFiles as Record<string, string> | null) ?? undefined,
        isHidden: testcaseSet.isHidden,
        stdin: testcase.stdin,
        weight: testcaseSet.weight
      }))
    ),
    timeLimitMs: submission.problem.timeLimitMs
  };
}
```

**Step 2: Update `apps/worker/src/processors/submission.ts`**

```ts
import type { Job } from "bullmq";

import { submissionJudgeJobSchema, type SubmissionJudgeJob } from "@nojv/core";
import type { SandboxExecutor } from "@nojv/core";

import { completeSubmission, getSubmissionJudgeContext, markSubmissionRunning } from "../services/judge-db.js";
import { judgeSubmission } from "../services/submission-runner.js";

export function createSubmissionProcessor(executor: SandboxExecutor) {
  return async function processSubmission(job: Job<SubmissionJudgeJob>) {
    const payload = submissionJudgeJobSchema.parse(job.data);

    await markSubmissionRunning(payload.submissionId);
    const judgeContext = await getSubmissionJudgeContext(payload.submissionId);

    if (!judgeContext) {
      throw new Error(`Submission context not found for ${payload.submissionId}.`);
    }

    const result = await judgeSubmission(
      payload.submissionId,
      payload.draft,
      judgeContext,
      executor
    );
    await completeSubmission(payload.submissionId, result);

    return result;
  };
}
```

Key changes: imports from `@nojv/core` instead of `@nojv/db` and `@nojv/queue`. `SandboxExecutor` from `@nojv/core`.

**Step 3: Update `apps/worker/src/processors/cheating-signal.ts`**

```ts
import type { Job } from "bullmq";

import {
  cheatingSignalSchema,
  evaluateIntegritySignals,
  integrityAssessmentSchema,
  type CheatingSignal
} from "@nojv/core";

export function processCheatingSignal(job: Job<CheatingSignal>) {
  const payload = cheatingSignalSchema.parse(job.data);

  return Promise.resolve(integrityAssessmentSchema.parse(evaluateIntegritySignals([payload])));
}
```

Change: `@nojv/domain` → `@nojv/core`.

**Step 4: Update `apps/worker/src/worker-app.ts`**

```ts
import { queueNames } from "@nojv/core";
// ... rest unchanged
```

Change: `@nojv/queue` → `@nojv/core`.

**Step 5: Update `apps/worker/src/services/submission-runner.ts`**

```ts
import {
  submissionResultSchema,
  type SubmissionDraft,
  type SubmissionResult,
  type SandboxExecutor,
  type SandboxRequest,
  type SandboxResult
} from "@nojv/core";

import type { SubmissionJudgeContext } from "./judge-db.js";

// Remove local verdictMap — keep as-is since it maps sandbox verdicts to domain verdicts
const verdictMap: Record<string, SubmissionResult["verdict"]> = {
  WA: "wrong_answer",
  TLE: "time_limit_exceeded",
  MLE: "memory_limit_exceeded",
  RE: "runtime_error",
  SE: "runtime_error"
};

// ... rest of judgeSubmission() and mapResult() unchanged
```

Key changes:
- `SandboxExecutor`, `SandboxRequest`, `SandboxResult` from `@nojv/core` (instead of local `sandbox-executor.ts`)
- `SubmissionJudgeContext` from `./judge-db.js` (instead of `@nojv/db`)

**Step 6: Delete `apps/worker/src/services/sandbox-executor.ts`**

This file is replaced by the shared types in `@nojv/core/src/sandbox.ts`.

**Step 7: Update `apps/worker/src/services/docker-executor.ts`**

```ts
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sourceFileNames, type SandboxExecutor, type SandboxRequest, type SandboxResult } from "@nojv/core";

// DELETE the local sourceFileNames Record (lines 9-18) — now imported from @nojv/core

// ... rest of languageExtensions, resolveScriptExtension, DockerExecutor class unchanged
// but update type references to use imported SandboxRequest/SandboxResult
```

Key changes:
- Import `sourceFileNames`, `SandboxExecutor`, `SandboxRequest`, `SandboxResult` from `@nojv/core`
- Delete local `sourceFileNames` Record (9 lines)
- Delete local import of `./sandbox-executor`

**Step 8: Update `apps/worker/src/services/k8s-executor.ts`**

```ts
import { sourceExtensions, type SandboxExecutor, type SandboxRequest, type SandboxResult } from "@nojv/core";

// DELETE the local sourceExtension() function (lines 23-42) — use sourceExtensions map from @nojv/core
// Replace sourceExtension(request.language) with sourceExtensions[request.language]
```

Key changes:
- Import `sourceExtensions`, `SandboxExecutor`, `SandboxRequest`, `SandboxResult` from `@nojv/core`
- Delete local `sourceExtension()` function
- Replace calls: `sourceExtension(request.language)` → `sourceExtensions[request.language]`
- Delete local import of `./sandbox-executor.js`

**Step 9: Update `apps/worker/src/services/executor-factory.ts`**

```ts
import type { SandboxExecutor } from "@nojv/core";
// Remove: import type { SandboxExecutor } from "./sandbox-executor.js";
// ... rest unchanged
```

**Step 10: Update `apps/worker/package.json`**

```json
"dependencies": {
  "@kubernetes/client-node": "^1.0.0",
  "@nojv/core": "workspace:*",
  "@nojv/db": "workspace:*",
  "bullmq": "^5.70.4",
  "zod": "^4.3.6"
}
```

Remove `"@nojv/domain"` and `"@nojv/queue"`.

**Step 11: Verify worker builds**

```bash
cd /Users/takala/code/NOJV
pnpm install && pnpm --filter @nojv/worker typecheck
```

**Step 12: Commit**

```bash
git add apps/worker/
git commit -m "refactor: migrate worker from @nojv/domain + @nojv/queue to @nojv/core, move judge-db locally"
```

---

### Task 7: Update Sandbox-Runner

**Files to modify:**
- Modify: `apps/sandbox-runner/src/types.ts`
- Modify: `apps/sandbox-runner/src/index.ts`
- Modify: `apps/sandbox-runner/src/compiler.ts`
- Modify: `apps/sandbox-runner/src/judges/standard.ts`
- Modify: `apps/sandbox-runner/src/judges/checker.ts`
- Modify: `apps/sandbox-runner/src/judges/interactive.ts`
- Modify: `apps/sandbox-runner/package.json`

**Step 1: Rewrite `apps/sandbox-runner/src/types.ts`**

Replace local type definitions with re-exports from `@nojv/core`:

```ts
import { z } from "zod";
import { languageSchema, judgeTypeSchema, submissionTypeSchema } from "@nojv/core";

export type {
  SandboxConfig,
  SandboxResult,
  SandboxTestcase,
  SandboxTestcaseResult,
  SandboxVerdict
} from "@nojv/core";

// Config schema for validating /submission/config.json
// Uses domain enums from @nojv/core for consistency
export const SandboxInputSchema = z.object({
  submissionId: z.string(),
  language: languageSchema,
  judgeType: judgeTypeSchema,
  submissionType: submissionTypeSchema,
  limits: z.object({
    timeoutMs: z.number(),
    memoryMb: z.number()
  }),
  template: z
    .object({
      driverCode: z.string(),
      insertionMarker: z.string()
    })
    .optional(),
  checkerLanguage: z.string().optional(),
  interactorLanguage: z.string().optional()
});

export type SandboxInput = z.infer<typeof SandboxInputSchema>;

// Testcase files read from disk (not from config.json)
export interface TestcaseFiles {
  index: number;
  input: string;
  expected?: string | undefined;
  weight: number;
  isSample: boolean;
}

// Re-export for backward compatibility within sandbox-runner
// (judges import TestcaseResult from types.ts)
export type { SandboxTestcaseResult as TestcaseResult } from "@nojv/core";

// Re-export for index.ts which constructs SandboxOutput
export type { SandboxResult as SandboxOutput } from "@nojv/core";
```

Key changes:
- Local `TestcaseResult` and `SandboxOutput` interfaces → re-exported from `@nojv/core`
- Local Zod enum literals → use `languageSchema`, `judgeTypeSchema`, `submissionTypeSchema` from `@nojv/core`
- `SandboxInputSchema` stays as a Zod schema (used for config.json validation), but uses shared enum schemas

**Step 2: Update `apps/sandbox-runner/src/compiler.ts`**

```ts
import { sourceFileNames } from "@nojv/core";
import type { SandboxInput } from "./types";

// DELETE the local sourceFileName() function (lines 32-50)
// Replace with:
export function sourceFileName(language: SandboxInput["language"]): string {
  return sourceFileNames[language];
}

// ... rest of compiler.ts unchanged
```

**Step 3: Update `apps/sandbox-runner/package.json`**

```json
"dependencies": {
  "@nojv/core": "workspace:*",
  "zod": "^4.3.6"
}
```

Note: esbuild bundles `@nojv/core` into the output, so the Docker image doesn't need it at runtime.

**Step 4: Check judge files**

The judge files (`standard.ts`, `checker.ts`, `interactive.ts`) import `TestcaseResult` and `TestcaseFiles` from `../types`. Since we re-exported `TestcaseResult` from types.ts, these files should work without changes. Verify:

```bash
cd /Users/takala/code/NOJV
pnpm --filter @nojv/sandbox-runner typecheck
```

**Step 5: Verify esbuild still works**

```bash
pnpm --filter @nojv/sandbox-runner build
```

**Step 6: Commit**

```bash
git add apps/sandbox-runner/
git commit -m "refactor: sandbox-runner uses shared types from @nojv/core"
```

---

### Task 8: Strip Down `@nojv/db`

**Files to modify:**
- Delete: `packages/db/src/judge-operations.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/package.json`

**Step 1: Delete `packages/db/src/judge-operations.ts`**

This entire file is now dead:
- Worker-specific functions moved to `apps/worker/src/services/judge-db.ts` (Task 6)
- `getSubmissionOperation` inlined in web route (Task 5)
- All workspace-run and cheating-case functions are unused dead code

**Step 2: Simplify `packages/db/src/index.ts`**

```ts
import type { Prisma } from "../generated/prisma/client";

export * from "./client";
export * from "./env";
export type { Prisma };
export type TransactionClient = Prisma.TransactionClient;
```

Change: Remove `export * from "./judge-operations"`.

**Step 3: Update `packages/db/package.json`**

Remove `@nojv/domain` dependency (no longer needed):

```json
"dependencies": {
  "@prisma/adapter-pg": "^7.4.2",
  "@prisma/client": "^7.4.2",
  "pg": "^8.20.0",
  "zod": "^4.3.6"
}
```

**Step 4: Verify db builds**

```bash
cd /Users/takala/code/NOJV
pnpm install && pnpm --filter @nojv/db build
```

**Step 5: Commit**

```bash
git add packages/db/
git commit -m "refactor: strip @nojv/db to prisma client + env only"
```

---

### Task 9: Delete Old Packages

**Step 1: Delete `packages/domain/`**

```bash
rm -rf /Users/takala/code/NOJV/packages/domain
```

**Step 2: Delete `packages/queue/`**

```bash
rm -rf /Users/takala/code/NOJV/packages/queue
```

**Step 3: Reinstall**

```bash
cd /Users/takala/code/NOJV
pnpm install
```

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete @nojv/domain and @nojv/queue (replaced by @nojv/core)"
```

---

### Task 10: Full Verification

**Step 1: Full build**

```bash
cd /Users/takala/code/NOJV
pnpm build
```

**Step 2: Full test**

```bash
pnpm test
```

**Step 3: Full typecheck**

```bash
pnpm typecheck
```

**Step 4: Lint**

```bash
pnpm lint
```

All should pass. Fix any issues before final commit.

**Step 5: Final commit (if fixes were needed)**

```bash
git add -A
git commit -m "fix: resolve build/test issues from packages refactor"
```

---

## Summary of Changes

| Action | Files |
|---|---|
| **Created** | `packages/core/` (4 src files, 4 test files, 4 config files) |
| **Created** | `apps/worker/src/services/judge-db.ts` |
| **Deleted** | `packages/domain/` (entire directory) |
| **Deleted** | `packages/queue/` (entire directory) |
| **Deleted** | `packages/db/src/judge-operations.ts` |
| **Deleted** | `apps/worker/src/services/sandbox-executor.ts` |
| **Modified** | ~20 files (import path updates) |

**Lines removed** (approx):
- ~200 lines dead code in `judge-operations.ts` (workspace-run, cheating-case, mapping exports)
- ~30 lines queue over-abstraction (`QueueEnvelope`, factory functions)
- ~15 lines `problemUpdateSchema` duplication
- ~50 lines duplicated sandbox types + source filename mappings

**Net effect**: 3 packages → 2 packages, ~300 fewer lines, zero type duplication between worker and sandbox-runner.
