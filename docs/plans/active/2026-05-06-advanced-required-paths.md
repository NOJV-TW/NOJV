# Advanced-mode Required Paths — Implementation Plan

**Goal:** Let TA declare required file/folder paths on `special_env` problems. Browser pre-flight rejects mis-structured ZIPs before submit; server re-validates as defense-in-depth. Static check only — no script execution, no glob, no optional/forbidden markers.

**Why:** Today a `special_env` student submission is a free-form ZIP. If the TA's judge image expects `src/main.c` and the student zips `homework/src/main.c`, the judge fails with a cryptic compile error. TAs end up writing defensive `[ -f ... ]` checks in every script. A declarative path list in the problem spec lets us catch the structural error in the browser before it ever reaches the worker.

**Scope (intentional non-goals):**

- No `forbiddenPatterns` — front-end already filters `.DS_Store` / `__MACOSX/`; the judge image ignores junk by definition.
- No optional markers — if a file is optional, the image handles "exists / not" logic. The schema describes the contract, not all conceivable file states.
- No globs — the only realistic glob ("at least one .c under src/") collapses to "folder `src/` must exist". Trailing `/` covers the case.
- No content/regex inspection — content-shape validation belongs in the judge image (return a `STRUCTURE_ERROR`-class verdict, future work).

**Architecture:** Single new `String[]` column on `Problem`; one pure validator in `@nojv/core` shared by browser staging and server submission path; small chip-list editor in the existing `special_env` problem-edit page.

**Tech Stack:** Prisma 7, Zod 4, SvelteKit, Tailwind, Vitest, Playwright.

---

## Phase 1 — Schema & Validator

### Task 1.1 — Add `advancedRequiredPaths` to `Problem`

**Files:**

- Modify: `packages/db/prisma/schema/problem.prisma`
- Create: `packages/db/prisma/migrations/20260506000000_problem_advanced_required_paths/migration.sql`

**Steps:**

1. Add column under the existing advanced-mode block on `Problem` (next to `advancedImageRef` / `advancedImageSource` around line 74):

   ```prisma
   /// special_env only. Each entry is a literal path; trailing "/" means
   /// "this folder must exist" (i.e. at least one uploaded file's path
   /// starts with this prefix). Validated by Zod refine: must be empty when
   /// type !== 'special_env'. See packages/core/src/schemas/required-paths.ts.
   advancedRequiredPaths String[] @default([])
   ```

2. Generate migration via `pnpm db:migrate dev --name problem_advanced_required_paths` then commit the SQL.

3. Run `pnpm db:generate`.

**Acceptance:** `pnpm typecheck` clean across workspace; `Problem.advancedRequiredPaths` typed as `string[]`.

### Task 1.2 — Schema + refine in `@nojv/core`

**Files:**

- Create: `packages/core/src/schemas/required-paths.ts`
- Modify: `packages/core/src/index.ts` (re-export)
- Modify: existing `problemUpdateSchema` / `problemCreateSchema` to include the field with `.refine()` enforcing emptiness on non-`special_env` types.

**Steps:**

1. New file:

   ```ts
   import { z } from "zod";

   const PATH_RE = /^[A-Za-z0-9._\-/]+$/;

   export const requiredPathSchema = z
     .string()
     .min(1)
     .max(256)
     .regex(PATH_RE, "Path may only contain letters, digits, '.', '_', '-', '/'.")
     .refine((p) => !p.includes(".."), "Path may not contain '..'")
     .refine((p) => !p.startsWith("/"), "Path must be relative");

   export const requiredPathsSchema = z.array(requiredPathSchema).max(50).default([]);
   ```

2. In the problem create/update schemas, add the field and a top-level `.refine()`:

   ```ts
   .refine(
     (data) => data.type === "special_env" || (data.advancedRequiredPaths ?? []).length === 0,
     { message: "advancedRequiredPaths is only valid when type = special_env." },
   )
   ```

**Acceptance:** Existing problem create/update tests pass; new unit test asserts non-`special_env` problem rejects non-empty list.

### Task 1.3 — Pure validator function

**Files:**

- Create: `packages/core/src/validation/required-paths.ts`
- Modify: `packages/core/src/index.ts`
- Create: `tests/unit/core/required-paths.test.ts`

**Contract:**

```ts
export type RequiredPathError =
  | { kind: "missing_file"; path: string }
  | { kind: "missing_folder"; path: string };

export interface RequiredPathsResult {
  ok: boolean;
  errors: RequiredPathError[];
}

export function validateRequiredPaths(
  uploadedPaths: readonly string[],
  requiredPaths: readonly string[],
): RequiredPathsResult;
```

**Logic:**

- For each `req` in `requiredPaths`:
  - If `req.endsWith("/")` → check `uploadedPaths.some(p => p.startsWith(req))`; on miss push `missing_folder`.
  - Else → check `uploadedPaths.includes(req)`; on miss push `missing_file`.
- `ok = errors.length === 0`.

**Tests (≥6):**

1. All required files present → `ok: true`.
2. One required file missing → exactly one `missing_file` error with correct path.
3. Folder requirement satisfied by nested file (`src/` matched by `src/utils/foo.c`) → `ok: true`.
4. Folder requirement unsatisfied (no upload starts with prefix) → `missing_folder`.
5. Folder requirement matched by exact-prefix file (`src/` matched by `src/main.c`) → `ok: true`.
6. Empty `requiredPaths` → `ok: true` regardless of uploads.
7. Required path that happens to be a substring of an upload but not a prefix (e.g., `req = "main.c"`, upload = `src/main.c`) → `missing_file` (must be exact match for files).

**Acceptance:** `pnpm test:unit` — all new tests green; function exported from `@nojv/core`.

---

## Phase 2 — TA Editor UI

### Task 2.1 — `RequiredPathsSection.svelte`

**Files:**

- Create: `apps/web/src/lib/components/problem/advanced/RequiredPathsSection.svelte`
- Modify: `apps/web/messages/en.json` and `apps/web/messages/zh-TW.json` — add keys under `advancedRequiredPaths_*` (label, hint, addPlaceholder, fileBadge, folderBadge, emptyHelp, errorInvalid, errorDuplicate).

**UX:**

- Input box + "Add" button. Press Enter or click Add → push to list.
- Trailing `/` autoswitches the chip icon to 📁 (folder); otherwise 📄 (file).
- Each chip: icon + path text + remove (×) button.
- Empty state: subtle hint "no required paths — student may submit any structure".
- Inline validation: invalid chars / leading slash / `..` → red ring + `errorInvalid` message; duplicate → `errorDuplicate`.
- Stateless component: takes `value: string[]` + `onchange(next: string[])`.

**Acceptance:** Component renders independently; can add `src/main.c`, then `src/`, then duplicate → blocked; remove works; arrow-key/keyboard accessible; responsive on mobile.

### Task 2.2 — Wire into edit page

**Files:**

- Modify: `apps/web/src/routes/(app)/problems/[problemId]/edit/+page.svelte`
- Modify: `apps/web/src/routes/(app)/problems/[problemId]/edit/+page.server.ts`

**Steps:**

1. In the load function, pass `data.problem.advancedRequiredPaths` into the page data.
2. In the page Svelte file, after the `ImageSection` block (line ~201), add:

   ```svelte
   <section class="rounded-2xl border border-border bg-[color:var(--color-panel)] p-6 shadow-rest">
     <RequiredPathsSection
       value={requiredPaths}
       onchange={(next) => (requiredPaths = next)}
       onsave={saveRequiredPaths}
     />
   </section>
   ```

3. Add a `saveRequiredPaths` handler that POSTs to a small form action; existing pattern (see `saveImage` for `ImageSection`) is the template.

### Task 2.3 — Domain mutation + form action

**Files:**

- Modify: `packages/domain/src/problem/mutations.ts` — add `updateAdvancedRequiredPaths(actor, problemId, paths)` that calls `assertProblemEditAccess` then writes via repo.
- Modify: `packages/db/src/repositories/problem.ts` — add `updateAdvancedRequiredPaths(id, paths)` returning the updated row (or extend an existing `update` if the shape fits).
- Modify: edit page `+page.server.ts` — new form action that parses with `requiredPathsSchema`, calls the domain mutation.

**Acceptance:** Saving from the UI persists; reloading the page shows the same list; non-author teacher cannot save (403); non-`special_env` problem refuses non-empty list (400 from Zod refine).

---

## Phase 3 — Pre-flight + server enforcement

### Task 3.1 — Browser pre-flight in `AdvancedModeWorkspace.svelte`

**Files:**

- Modify: `apps/web/src/lib/components/problem/advanced/AdvancedModeWorkspace.svelte`

**Steps:**

1. Accept `requiredPaths: string[]` as a new prop (passed from `ProblemSolveView` → already has the problem object; pipe `problem.advancedRequiredPaths` through).
2. After JSZip finishes building `entries` (around line 167), call `validateRequiredPaths(entries.map(e => e.path), requiredPaths)`.
3. On `!result.ok`: set `stagingError` to a localized message listing missing items (use `m.advancedRequiredPaths_missingList(...)`); do not set `staged`.
4. Mirror the check in the single-file branch (line 186-198) — single file vs multi-file uses the same validator; for single-file uploads the validator will trivially fail if any required path is set, which is the correct behavior (single-file uploads don't satisfy a multi-file schema).

**Acceptance:** Manual: TA sets `src/main.c` required; student uploads ZIP without that path → red error with the missing path; student uploads correct ZIP → submit button enables.

### Task 3.2 — Server validation in `createQueuedSubmissionRecord`

**Files:**

- Modify: `packages/domain/src/submission/mutations.ts` (around line 135 where `special_env` workspace logic lives)

**Steps:**

1. Right after the existing `if (problem.type !== "special_env")` block (line 136-151), add:

   ```ts
   if (problem.type === "special_env" && problem.advancedRequiredPaths.length > 0) {
     const uploaded = (payload.sourceFiles ?? []).map((f) => f.path);
     const result = validateRequiredPaths(uploaded, problem.advancedRequiredPaths);
     if (!result.ok) {
       throw new ConflictError(
         `Submission missing required paths: ${result.errors.map((e) => e.path).join(", ")}`,
       );
     }
   }
   ```

2. Import `validateRequiredPaths` from `@nojv/core`.

**Acceptance:** Direct `POST /api/submissions` (bypassing browser) with a missing path returns 409 with a message naming the missing path; valid payload still queues normally.

---

## Phase 4 — Tests

### Task 4.1 — Unit tests (already in 1.3)

Covered in Phase 1.

### Task 4.2 — Domain test

**Files:**

- Create: `tests/unit/domain/submission-required-paths.test.ts`

**Cases (≥3):**

- `special_env` problem with `["src/main.c"]` + payload missing it → throws `ConflictError`.
- `special_env` problem with `["src/"]` + payload contains `src/util.c` → succeeds.
- Non-`special_env` problem ignores the field even if non-empty (defense-in-depth — DB shouldn't have this state due to Zod refine, but the runtime check should not blow up).

### Task 4.3 — E2E spec

**Files:**

- Create: `tests/e2e/advanced-required-paths.spec.ts`

**Flow:**

1. Log in as teacher, open a `special_env` problem edit page.
2. Add `src/main.c` and `src/` to required paths; save; reload; assert chips persist.
3. Log in as student, open the problem.
4. Upload a ZIP missing `src/main.c` → assert visible error mentioning the path; submit button stays disabled (or staged is `null`).
5. Upload a ZIP containing `src/main.c` and `src/util.c` → assert no error; submit goes through and lands on result page.

**Acceptance:** `pnpm test:e2e tests/e2e/advanced-required-paths.spec.ts` passes locally.

---

## Risks & Open Questions

- **Path-rule simplicity**: trailing `/` is the only structural marker. If TAs ask for "exactly these files, no extras" we'll add a `Problem.advancedDisallowExtraFiles: boolean` later — explicitly out of scope for v1.
- **Single-file uploads**: with required paths set, a single-file upload (the current alternate code path) will always fail validation. That's the correct semantics ("structured submission required") but the error message must be explicit so users don't get confused. Phase 3.1 message keys must cover this case.
- **Migration**: `String[]` columns are PostgreSQL native; no data migration needed (`@default([])` covers existing rows).
- **i18n**: every new string goes through paraglide; remember to run `pnpm exec paraglide-js compile` after editing message JSONs.

## Out of Scope (future plans)

- TA-uploaded starter ZIP (let students download the canonical scaffold). Tracked as a separate feature when demand arises — most teachers can paste a scaffold into the problem statement instead.
- Content-shape validation (function signatures, AST checks). Belongs in the judge image; will require a `STRUCTURE_ERROR` verdict.
- Forbid-pattern rules.
