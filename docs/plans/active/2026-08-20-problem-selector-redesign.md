# Problem Selector Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace hidden click-to-add problem pickers with one explicit, multi-select problem selector shared by assignment, exam, and contest flows.

**Architecture:** Add a small dialog component that owns search, grouping, checkbox selection, and confirmation. Existing parent components keep ownership of ordered selected rows, points, permissions, and save actions. The existing `ProblemPicker` becomes the creation-flow adapter around the same dialog.

**Tech Stack:** SvelteKit, Svelte 5 runes, Bits UI Dialog, Tailwind CSS 4, Lucide icons, Paraglide messages.

---

### Task 1: Build the shared selector dialog

**Files:**

- Create: `apps/web/src/lib/components/features/problem/ProblemSelectDialog.svelte`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/zh-TW.json`

Implement a controlled dialog with searchable public/personal sections, accessible native checkboxes, selected-count footer, empty state, cancel, and confirm. Return selected candidate objects to the parent; do not persist data from the dialog.

### Task 2: Update creation-flow picker

**Files:**

- Modify: `apps/web/src/lib/components/features/course/exam/ProblemPicker.svelte`

Replace the always-visible search-and-click list with an explicit `Add problems` trigger and the shared selector. Keep selected rows, drag ordering, `onProblemIdsChange`, and the existing empty/error states.

### Task 3: Update assignment and exam management

**Files:**

- Modify: `apps/web/src/lib/components/features/course/assignment/AssignmentProblemsTab.svelte`
- Modify: `apps/web/src/lib/components/features/course/exam/ExamProblemsTab.svelte`

Add the explicit selector trigger, append confirmed candidates to local ordered rows, remove the hidden picker panels, and replace detach `X` icons with borderless `Trash2` controls. Keep preview, rejudge, drag ordering, and save actions.

### Task 4: Update contest management

**Files:**

- Modify: `apps/web/src/lib/components/features/contest/ContestSettingsTab.svelte`
- Modify: `apps/web/src/routes/(app)/contests/[contestId]/+page.server.ts`
- Modify: `apps/web/src/routes/(app)/contests/[contestId]/+page.svelte`
- Modify: `apps/web/src/routes/(app)/contests/new/+page.svelte`

Load candidate problem groups for managers, pass them to settings, replace blank manual ID rows with selected problem rows, and use the shared selector for both new and existing contests. Preserve points, ordering, and form submission.

### Task 5: Verify

Run `pnpm --filter @nojv/web check`, `pnpm --filter @nojv/web lint`, Prettier check, and `git diff --check`. Use Playwright to verify assignment, exam, contest settings, and contest creation at desktop and narrow widths; save screenshots for review.
