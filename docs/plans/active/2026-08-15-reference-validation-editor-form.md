# Reference Validation and Editor Form Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore reference-solution polling and tighten the problem editor's visibility, required runtime fields, and reference-editor spacing.

**Architecture:** Keep reference submissions private and excluded from lists, but allow their owner or an Admin to read the direct submission operation used by polling. Reuse the existing Bits UI Select and form schema; make runtime limits truly required instead of silently defaulting cleared values.

**Tech Stack:** Svelte 5, SvelteKit, Bits UI, Zod 4, Prisma, Vitest, Playwright.

---

### Task 1: Reference submission polling

**Files:**

- Modify: `packages/db/src/repositories/submission.ts`
- Test: `tests/integration/api/submissions.test.ts`

1. Add a failing integration test proving the reference submitter can directly read the submission while another user cannot and list queries still exclude it.
2. Run the focused integration test and confirm the current `Submission not found.` failure.
3. Remove only the reference-solution exclusion from the owner/Admin direct-read query.
4. Re-run the focused test.

### Task 2: Visibility and required runtime fields

**Files:**

- Modify: `apps/web/src/lib/components/features/problem/tabs/BasicInfoTab.svelte`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/zh-TW.json`
- Modify: `packages/core/src/schemas/problem.ts`
- Test: `tests/unit/core/schemas.test.ts`
- Test: `tests/e2e/problems.test.ts`

1. Add failing schema coverage for missing time and memory limits.
2. Remove schema defaults for both required fields.
3. Replace the student visibility cards with the existing Select and map its two choices to `adminMayPublish` while keeping visibility private.
4. Add required markers, `required` attributes, field names, and validation messages to both runtime inputs.
5. Update the visibility help copy in both locales.

### Task 3: Reference editor spacing

**Files:**

- Modify: `apps/web/src/lib/components/features/problem/reference/ReferenceSolutionSection.svelte`
- Test: `tests/unit/web/reference-solution-section.test.ts`

1. Replace the inline label and sibling margin interaction with a block/grid layout and explicit gap.
2. Verify the language selector and Monaco border remain separated when the selector is focused.

### Task 4: Verification

1. Compile Paraglide messages.
2. Run focused unit and integration tests.
3. Launch the web app and inspect desktop plus narrow viewport states.
4. Run the relevant Playwright E2E tests, formatting, lint, typecheck, and `pnpm ci:verify` if focused checks pass.

### Task 5: Reference validation diagnostics

**Files:**

- Modify: `apps/web/src/lib/components/features/problem/reference/ReferenceSolutionSection.svelte`
- Modify: `apps/web/src/lib/components/features/submission/CaseResultGrid.svelte`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/zh-TW.json`
- Test: `tests/unit/web/reference-solution-section.test.ts`

1. Preserve the completed submission result after a failed reference validation.
2. Reuse the existing testcase result component to show failed groups, case location, verdict, runtime, and memory inline.
3. Display testcase ordinals as one-based numbers and direct authors back to Testcase Management for the matching input and expected output.
