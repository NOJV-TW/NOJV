# Complete Online Judge Features Plan

## Goal
Complete all judging features for the NOJV online judge:
1. Full support for 3 judging modes: **standard**, **checker**, **interactive**
2. Two problem display modes: **full document** (full_source) and **template** (function)
3. Complete problem creation and editing for all modes
4. Complete scoring/grading pipeline

## Current State Summary

| Component | Status | Notes |
|-----------|--------|-------|
| DB Schema | ✅ Complete | JudgeType enum, SubmissionType enum, ProblemTemplate model, Testcase model all exist |
| Domain Schemas | ✅ Complete | problemCreateSchema, judgeTypeSchema, submissionTypeSchema exported |
| Sandbox Runner | ✅ Complete | standard, checker, interactive judges + function mode template injection all implemented |
| Worker | ✅ Complete | Handles all judge types, Docker + K8s executors |
| Frontend Creation | ⚠️ Partial | Has judge type selector + checker/interactor script fields, but missing template UI, submission type toggle, time/memory limits |
| Frontend Display | ⚠️ Partial | No template mode in editor, no submission type awareness, starterByLanguage is hardcoded |
| Backend API | ⚠️ Partial | Missing template CRUD, problem update, dynamic starter code |
| E2E Tests | ❌ None | Old Next.js tests deleted, no SvelteKit tests created |

## Architecture

### Problem Display Modes

**Full Source (`full_source`):**
- User writes complete program (stdin → stdout)
- Editor shows full starter code per language
- Standard OJ experience

**Template/Function (`function`):**
- Problem creator provides `driverCode` + `insertionMarker` + `templateCode` per language
- `driverCode`: Complete program with `// __USER_CODE__` marker
- `templateCode`: The visible portion shown to user (function signature + body)
- User edits only the template portion
- On submit: `driverCode.replace(insertionMarker, userCode)` forms the final source

### Judging Modes

**Standard:** Compare normalized stdout vs expected stdout per testcase
**Checker:** Run checker program: `checker <input> <expected> <user_output>` → exit 0 = AC
**Interactive:** Bidirectional pipes: solution ↔ interactor, interactor exit code determines verdict

## Agent Assignments

### Agent 1: Backend Expert
**Scope:** `packages/domain/`, `packages/db/`, `apps/web/src/lib/server/`, `apps/web/src/routes/api/`

**Tasks:**
1. Update `ProblemDetail` type (`apps/web/src/lib/problem-types.ts`):
   - Add `submissionType: "full_source" | "function"`
   - Add `templates: Record<Language, { driverCode: string; templateCode: string; insertionMarker: string }>`
   - Add `timeLimitMs: number`, `memoryLimitMb: number`
   - Add `checkerScript?: string`, `interactorScript?: string`

2. Update read-model (`apps/web/src/lib/server/read-model.ts`):
   - Fetch templates from DB when loading problem detail
   - Map `ProblemTemplate[]` → `Record<Language, TemplateInfo>`
   - Include judgeType, submissionType, limits in problem detail query

3. Update problem creation data-access (`apps/web/src/lib/server/data-access/problems.ts`):
   - Handle template creation as part of problem creation
   - Create `ProblemTemplate` records when submissionType = "function"
   - Handle starter code (store as templates with empty driverCode?)

4. Create problem update API:
   - `PUT /api/problems/[slug]/+server.ts` — update problem metadata, statement, testcases
   - `PUT /api/problems/[slug]/templates/+server.ts` — update templates per language
   - Requires admin/creator authorization

5. Update submission creation:
   - Pass `submissionType` through to queue job
   - When `function` mode: server-side template injection before sandboxing

6. Update domain schema if needed:
   - Ensure `problemCreateSchema` includes template fields for function mode
   - Add update schema

### Agent 2: Frontend UI/UX Expert
**Scope:** `apps/web/src/lib/components/`, `apps/web/src/routes/[locale]/problems/`

**Tasks:**
1. Enhance `ProblemCreationPanel.svelte`:
   - Add submission type radio: "Full Source" / "Function (Template)"
   - When "Function": show template editor per language with:
     - Driver code textarea (with insertion marker highlight)
     - Template code textarea (what user sees)
     - Insertion marker input (default: `// __USER_CODE__`)
   - Add time limit (ms) and memory limit (MB) number inputs
   - Add checker/interactor language dropdown (c, cpp, python)
   - Add starter code editor per language (for full_source mode)

2. Enhance `ProblemEditor.svelte`:
   - Detect submission type from problem data
   - **Full source mode**: Current behavior (show starter code, full editor)
   - **Function/template mode**:
     - Show template code in editor (the user-editable portion)
     - Show read-only context above/below the editable region (greyed out)
     - Or: only show the editable template portion
   - Update submission payload to include submissionType

3. Enhance `ProblemWorkspace.svelte`:
   - Show judge type badge (Standard / Checker / Interactive)
   - Show submission type indicator (Full Source / Function)
   - Pass templates to ProblemEditor

4. Create problem edit page:
   - `apps/web/src/routes/[locale]/problems/[slug]/edit/+page.svelte`
   - Reuse ProblemCreationPanel in "edit" mode
   - Load existing problem data, allow updates

### Agent 3: Sandbox Expert
**Scope:** `apps/sandbox-runner/`, `apps/worker/`

**Tasks:**
1. Audit all 3 judges for correctness and edge cases:
   - Standard: verify normalization logic (whitespace handling, trailing newlines)
   - Checker: verify protocol (exit codes, score parsing, timeout handling)
   - Interactive: verify pipe handling (deadlock prevention, cleanup)

2. Add checker/interactor language support:
   - Currently checker/interactor scripts are run - verify compilation support
   - Add language detection or explicit language field in config
   - Support compiled checkers (C++, Rust) and interpreted (Python)

3. Improve error reporting:
   - Better error messages when checker fails to compile
   - Better error messages for interactive timeout/deadlock
   - Include checker stderr in feedback when checker crashes

4. Template validation:
   - Validate insertion marker exists in driverCode before running
   - Better error when template injection fails
   - Handle edge cases (multiple markers, missing marker)

5. Add integration tests for any new functionality

### Agent 4: E2E Test Expert
**Scope:** `apps/web/tests/`, test configuration

**Tasks:**
1. Set up Vitest for SvelteKit:
   - Create `apps/web/vitest.config.ts` with SvelteKit support
   - Install `@testing-library/svelte`, `jsdom` if needed

2. Write unit tests for shared utilities:
   - `src/lib/school-verification.ts`
   - `src/lib/auth-onboarding.ts`
   - `src/lib/course-assessment-helpers.ts`
   - `src/lib/verdict-colors.ts`

3. Write API route integration tests (with mocked DB):
   - Problem creation (all 3 judge types)
   - Submission creation and polling
   - Template CRUD

4. Write component tests:
   - ProblemCreationPanel (form validation, mode switching)
   - ProblemEditor (language switching, template mode)

## API Contracts (for Frontend ↔ Backend alignment)

### GET /api/problems/[slug] (enhanced response)
```typescript
{
  // existing fields...
  submissionType: "full_source" | "function",
  judgeType: "standard" | "checker" | "interactive",
  timeLimitMs: number,
  memoryLimitMb: number,
  checkerScript?: string,
  interactorScript?: string,
  templates: {
    [language: string]: {
      driverCode: string,
      templateCode: string,
      insertionMarker: string
    }
  },
  starterByLanguage: { [language: string]: string }
}
```

### PUT /api/problems/[slug]
```typescript
// Request body: same as POST /api/problems but partial (only changed fields)
{
  title?: string,
  statement?: string,
  difficulty?: string,
  judgeType?: "standard" | "checker" | "interactive",
  submissionType?: "full_source" | "function",
  timeLimitMs?: number,
  memoryLimitMb?: number,
  checkerScript?: string,
  interactorScript?: string,
  templates?: { [language: string]: { driverCode: string, templateCode: string, insertionMarker: string } },
  starterByLanguage?: { [language: string]: string }
}
```

### POST /api/submissions (enhanced request)
```typescript
{
  // existing fields...
  submissionType: "full_source" | "function"  // NEW: determines if template injection needed
}
```
