# Boss Demo Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate demo-breaking configuration gaps and polish the boss-facing presentation so the current NOJV slice feels coherent, deployable, and complete.

**Architecture:** Keep the current monorepo boundaries intact. Add small, testable helpers for public app URLs and session identifiers, then wire them into the existing web and workspace surfaces so links, telemetry, and runtime history are context-aware instead of relying on hard-coded localhost or demo identifiers.

**Tech Stack:** Next.js 16, Vite 7, React 19, TypeScript 5.9, Vitest 4, Zod 4, pnpm workspace

---

### Task 1: Harden Cross-App Launch URLs

**Files:**

- Create: `apps/web/src/lib/workspace-launch.ts`
- Modify: `apps/web/src/app/[locale]/page.tsx`
- Modify: `apps/web/src/components/problem-editor.tsx`
- Test: `apps/web/tests/workspace-launch.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { buildWorkspaceLaunchUrl, resolveWorkspaceAppUrl } from "../src/lib/workspace-launch";

describe("resolveWorkspaceAppUrl", () => {
  it("uses NEXT_PUBLIC_WORKSPACE_URL when present", () => {
    expect(
      resolveWorkspaceAppUrl({
        NEXT_PUBLIC_WORKSPACE_URL: "https://workspace.nojv.dev/"
      })
    ).toBe("https://workspace.nojv.dev");
  });

  it("falls back to the validated local workspace origin in development", () => {
    expect(resolveWorkspaceAppUrl({})).toBe("http://localhost:4173");
  });
});

describe("buildWorkspaceLaunchUrl", () => {
  it("preserves course assessment context in the workspace link", () => {
    expect(
      buildWorkspaceLaunchUrl("https://workspace.nojv.dev", {
        assessment: {
          assessmentSlug: "hw1-process-trace",
          courseSlug: "os-lab-spring-2026",
          kind: "assignment"
        }
      })
    ).toBe(
      "https://workspace.nojv.dev/?mode=assignment&course=os-lab-spring-2026&assessment=hw1-process-trace"
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @nojv/web test -- workspace-launch.test.ts`
Expected: FAIL because the helper module does not exist yet.

**Step 3: Write minimal implementation**

```ts
export function resolveWorkspaceAppUrl(env: Record<string, string | undefined>) {
  // validate absolute http/https URL and trim trailing slash
}

export function buildWorkspaceLaunchUrl(baseUrl: string, options: ...) {
  // build mode/course/assessment/contest search params
}
```

Use the helper in the home page CTA and the problem editor workspace link so the web app stops hard-coding `http://localhost:4173`.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @nojv/web test -- workspace-launch.test.ts`
Expected: PASS

### Task 2: Generate Context-Aware Session Identifiers

**Files:**

- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/tests/session-identifiers.test.ts`
- Modify: `apps/workspace/src/App.tsx`
- Modify: `apps/web/src/components/problem-editor.tsx`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { buildEditorSessionId, buildWorkspaceSessionId } from "../src/index";

describe("buildWorkspaceSessionId", () => {
  it("derives a stable assignment session id from course context", () => {
    expect(
      buildWorkspaceSessionId({
        assessmentSlug: "hw1-process-trace",
        courseSlug: "os-lab-spring-2026",
        mode: "assignment"
      })
    ).toBe("ws_assignment_os-lab-spring-2026_hw1-process-trace");
  });
});

describe("buildEditorSessionId", () => {
  it("keeps problem telemetry distinct across contest and practice contexts", () => {
    expect(
      buildEditorSessionId({
        contestSlug: "spring-qualifier-2026",
        problemSlug: "warmup-sum"
      })
    ).toBe("editor_warmup-sum_contest_spring-qualifier-2026");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @nojv/domain test -- session-identifiers.test.ts`
Expected: FAIL because the exported helpers do not exist yet.

**Step 3: Write minimal implementation**

```ts
export function buildWorkspaceSessionId(input: ...) {
  // sanitize the relevant slugs and join them into a bounded session id
}

export function buildEditorSessionId(input: ...) {
  // derive a stable editor session id from problem + context
}
```

Wire these helpers into the workspace request payload, the workspace session badge, and the telemetry probe session id.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @nojv/domain test -- session-identifiers.test.ts`
Expected: PASS

### Task 3: Remove Boss-Facing Demo Artifacts

**Files:**

- Modify: `apps/web/src/components/problem-editor.tsx`
- Modify: `apps/web/src/components/runtime-stats.tsx`
- Modify: `apps/workspace/src/App.tsx`
- Modify: `apps/web/src/lib/demo-data.ts`
- Modify: `apps/web/src/lib/server/actor-context.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { getProblemDetail } from "../src/lib/demo-data";

describe("presentation copy", () => {
  it("does not expose placeholder wording on public problem summaries", () => {
    const problem = getProblemDetail("distributed-labyrinth");

    expect(problem?.statement).not.toMatch(/POC|placeholder|demo/i);
    expect(problem?.summary).not.toMatch(/POC|placeholder|demo/i);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @nojv/web test -- presentation-copy.test.ts`
Expected: FAIL because the seeded public problem still contains placeholder wording.

**Step 3: Write minimal implementation**

```ts
// update public-facing copy so the UI reads like a polished product demo
// remove fixed "ws_assignment_demo_01" / "POC scope" labels from visible surfaces
// replace the default actor display from "POC Student" to a neutral learner identity
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @nojv/web test -- presentation-copy.test.ts`
Expected: PASS

### Task 4: Verify Full Repository Readiness

**Files:**

- Modify: `.env.example`
- Modify: `apps/workspace/vite.config.ts`
- Modify: `README.md`

**Step 1: Run focused verification**

Run: `pnpm --filter @nojv/domain test -- session-identifiers.test.ts && pnpm --filter @nojv/web test -- workspace-launch.test.ts presentation-copy.test.ts`
Expected: PASS

**Step 2: Verify repository-wide quality gate**

Run: `pnpm format && pnpm lint && pnpm test && pnpm build`
Expected: PASS

**Step 3: Verify setup contract**

Run: `pnpm db:validate && docker compose config`
Expected: PASS

**Step 4: Update docs**

Reflect the new environment variables and non-localhost launch behavior in `README.md` and `.env.example`.
