# Problem Picker Search Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let assignment, exam, and contest problem pickers search by public display ID and choose from separate public and personal problem sections.

**Architecture:** Add one application query that returns the existing editable candidates as the personal group plus all published public problems as the public group. Reuse one Svelte picker for assignment and exam, and feed the same picker into contest creation while keeping contest points and persisted problem IDs unchanged.

**Tech Stack:** Prisma repository queries, `@nojv/application`, Svelte 5, Paraglide messages, Vitest/typecheck.

**Status:** Completed 2026-08-16.

---

### Task 1: Provide grouped picker candidates

- Add a public problem repository list using the existing problem projection fields.
- Add an application query returning `{ publicProblems, personalProblems }` with display IDs.
- Add a small unit test for display-ID matching if a pure helper is extracted.

### Task 2: Update shared assignment/exam picker

- Rename/generalize the existing picker to accept grouped candidates.
- Render public and personal sections, deduplicate selected items, and match `#N`/`N` against `displayId`.
- Update assignment and exam create/edit loaders and imports.

### Task 3: Use the picker for contest creation

- Load grouped candidates on the contest creation page.
- Replace manual problem-ID text inputs with the picker while retaining per-problem points and the existing form payload.

### Task 4: Verify

- Compile updated Paraglide messages.
- Run focused typechecks/lint and the smallest relevant unit checks, then inspect the final diff.
