# Home Scroll Panels Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show every currently visible announcement and unfinished assessment while keeping the two desktop home panels equal-height and independently scrollable.

**Architecture:** Remove the homepage-only query limits while preserving the existing audience, publication, membership, and time filters. Keep the existing cards and rows; only make the desktop card shells a shared bounded height and move overflow to their list bodies. Group signed-in assessments by existing window state, not by adding tabs or a new component.

**Tech Stack:** Svelte 5, SvelteKit, Tailwind CSS 4, Prisma 7, Vitest

---

### Task 1: Specify the complete homepage data contract

**Files:**

- Modify: `packages/application/src/announcement/queries.ts`
- Modify: `packages/application/src/home/upcoming-assessments.ts`
- Modify: `packages/db/src/repositories/announcement.ts`
- Modify: `packages/db/src/repositories/assessment.ts`
- Test: `tests/unit/web/upcoming-assessments.test.ts`
- Test: `tests/unit/web/db-read-model.test.ts`

**Steps:**

1. Add failing expectations that homepage announcement and assignment reads omit `take`, and that the merged assessment result is not sliced.
2. Run the focused tests and confirm the new expectations fail.
3. Make `take` optional in the two repository reads, omit Prisma `take` when absent, and remove the homepage defaults and final slice.
4. Run the focused tests and confirm they pass.

### Task 2: Make the desktop panels equal-height and scrollable

**Files:**

- Modify: `apps/web/src/routes/(public)/+page.svelte`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/zh-TW.json`
- Test: `tests/unit/web/home-page-layout.test.ts`

**Steps:**

1. Replace the old content-height assertions with failing assertions for a stretched desktop grid, bounded desktop card height, fixed headers, and scrollable list bodies.
2. Run the focused component test and confirm it fails.
3. Apply one shared desktop height to both cards, keep the card headers outside `min-h-0 flex-1 overflow-y-auto` list bodies, and leave mobile as natural page scrolling.
4. In the signed-in assessment list, render existing open states before upcoming states while retaining the existing type and state badges.
5. Run the focused component test and confirm it passes.

### Task 3: Verify the finished change

**Files:**

- Verify: all files above

**Steps:**

1. Run focused unit tests for the homepage data and layout contracts.
2. Run web type checking, formatting, linting, and `git diff --check`.
3. Run the Impeccable layout detector once over the changed Svelte page.
4. Launch the app and inspect signed-in, signed-out, empty, populated, desktop, and mobile states in one bounded browser pass when local services are available.
5. Review the final diff against this plan and record any unavailable verification honestly.
