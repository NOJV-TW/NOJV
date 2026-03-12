# Deferred Simplifications

Identified during the 2026-03-13 full codebase simplify review. Each item was skipped because it exceeds a simple cleanup — requiring architectural changes, new endpoints, or broad test coverage.

## 1. K8s env: Zod discriminated union

**Current state:** `workerEnvSchema` marks K8s fields as `z.string().trim().optional()`. When `EXECUTION_BACKEND=kubernetes`, `executor-factory.ts` performs 5 sequential `if (!env.K8S_...)` runtime checks that throw.

**Desired state:** Use a Zod discriminated union (or `.superRefine()`) keyed on `EXECUTION_BACKEND`. When `kubernetes`, K8s fields become required at the schema level — TypeScript narrows the types automatically, and the runtime checks in `executor-factory.ts` become unnecessary.

**Files:**
- `apps/worker/src/env.ts` — schema definition
- `apps/worker/src/services/executor-factory.ts` — runtime checks to remove

**Why deferred:** Changes the shape of the parsed env type. All consumers of K8s fields would need type updates.

---

## 2. Judge process spawning deduplication

**Current state:** `checker.ts` and `standard.ts` both contain nearly identical logic for spawning a child process, writing to stdin, collecting stdout/stderr, handling EPIPE, setting timeouts, and interpreting the close event.

**Desired state:** Extract a shared `runProcessWithStdin(cmd, args, stdin, timeoutMs)` utility that returns `{ stdout, stderr, exitCode }`. Each judge calls this and differs only in result interpretation.

**Files:**
- `apps/sandbox-runner/src/judges/checker.ts`
- `apps/sandbox-runner/src/judges/standard.ts`

**Why deferred:** Critical execution path. Needs integration tests with a real sandbox environment to validate. The duplication is growing (EPIPE handler was the latest addition) so this should be prioritized.

---

## 3. Handle-completion guard deduplication

**Current state:** The redirect-to-`/complete-profile` guard exists in two places:
1. `apps/web/src/routes/+page.server.ts` (root home page)
2. `apps/web/src/routes/(app)/+layout.server.ts` (app layout)

Any new top-level page outside `(app)` would need to copy it again.

**Desired state:** Move the guard into `hooks.server.ts` or `+layout.server.ts` (root) so it applies universally. Need to define which routes are exempt (e.g., `/complete-profile` itself, auth routes, API routes).

**Files:**
- `apps/web/src/hooks.server.ts`
- `apps/web/src/routes/+layout.server.ts`
- `apps/web/src/routes/+page.server.ts`
- `apps/web/src/routes/(app)/+layout.server.ts`

**Why deferred:** Requires auditing all route groups to determine exemption rules. Getting it wrong breaks auth flow.

---

## 4. Submission `sourceCode` lazy loading

**Current state:** `listProblemSubmissions` selects `sourceCode` for all 50 submissions in the initial page load. Source code can be up to 50KB per submission. This data is serialized server→client even though it's only displayed when a user clicks into a specific submission detail.

**Desired state:** Exclude `sourceCode` from the list query. Add a `/api/submissions/[id]/source` endpoint (or similar) to fetch source on demand. Update `Workspace.svelte` to lazy-load when `viewingIndex` changes.

**Files:**
- `apps/web/src/lib/server/submission/queries.ts` — remove `sourceCode` from select
- `apps/web/src/lib/components/problem/Workspace.svelte` — add lazy loading
- New: API endpoint for source code retrieval

**Why deferred:** Requires a new API endpoint + client-side loading state. Functional change, not a simplification.

---

## 5. `parseSessionUser` redundant calls

**Current state:** The same request parses `locals.user` via `parseSessionUser` (Zod schema validation) multiple times:
- Root `+layout.server.ts` → parses once
- `(app)/+layout.server.ts` → `getActorContext()` parses again internally, then the layout calls `parseSessionUser` a third time to return `data.user`
- Individual page loaders (e.g., `account/+page.server.ts`) may parse yet again

**Desired state:** Parse once in the root layout or `hooks.server.ts`, store the typed `SessionUser` in `event.locals.sessionUser`, and read it downstream without re-parsing.

**Files:**
- `apps/web/src/hooks.server.ts`
- `apps/web/src/app.d.ts` — extend `App.Locals` type
- `apps/web/src/lib/server/auth.ts` — `getActorContext` reads from locals
- `apps/web/src/routes/+layout.server.ts`
- `apps/web/src/routes/(app)/+layout.server.ts`

**Why deferred:** Requires extending the `App.Locals` type and updating all consumers of `getActorContext` / `parseSessionUser`. The performance impact per-request is small (Zod parse is fast), but the code hygiene improvement is meaningful.
