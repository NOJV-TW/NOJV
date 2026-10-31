# Exam Draft and Publish Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make unpublished exams unmistakably drafts and guide course staff to publish them.

**Architecture:** Reuse the existing exam status model and shared `StatusPill`, `ExamRow`, and detail hero components. Add only presentation and localized copy changes: split draft list grouping, map the detail hero to the draft status, and show a manager-only publish guidance panel linking to the settings tab.

**Tech Stack:** SvelteKit, Svelte 5, Tailwind utility classes, Paraglide message catalogs, Vitest component tests.

**Spec:** `docs/superpowers/specs/2026-10-31-exam-draft-publish-guidance-design.md`

## Global Constraints

- Draft visibility remains limited to course managers; students must continue to receive the existing not-published access response.
- Published exam scheduling and countdown behavior must remain unchanged.
- All user-facing copy must be added to both `apps/web/messages/zh-TW.json` and `apps/web/messages/en.json`.
- Keep the existing publish action and server validation; this change is guidance and state presentation only.

## Review Focus

- A draft must not be grouped under `即將開始` / `Upcoming`; add a draft group assertion to the course exam list test.
- A draft detail hero must expose `草稿` / `Draft`, not `尚未開始` / `Scheduled`; add a status mapping assertion.
- The guidance action must link to the settings tab and be manager-only; add a detail rendering assertion or reuse the existing manager fixture.
- Published upcoming exams must retain their current scheduled label and countdown behavior; add a regression assertion alongside the draft cases.

### Task 1: Draft status and course list presentation

**Files:**

- Modify: `apps/web/src/routes/(app)/courses/[courseId]/exams/+page.svelte`
- Modify: `apps/web/src/lib/components/features/course/exam/ExamRow.svelte` only if the shared row needs a draft-specific treatment
- Test: `tests/component/web/exam-draft-publish-guidance.test.ts` (new)

**Interfaces:**

- Consumes: `PageData.exams` rows with `status: "draft" | "upcoming" | "running" | "ended"`.
- Produces: separate `draft` group and draft row status text exposed to staff.

- [ ] Write a failing component test proving draft exams render under a `草稿`/`Draft` heading and upcoming published exams remain under `即將開始`/`Upcoming`.
- [ ] Run the focused test and confirm it fails because drafts are currently merged into the upcoming group.
- [ ] Split the derived groups so `draft` is its own group and the existing upcoming group only contains `upcoming` rows.
- [ ] Add any missing localized group label and run the focused test until it passes.

### Task 2: Detail hero status and publish guidance

**Files:**

- Modify: `apps/web/src/routes/(app)/exams/[examId]/+page.svelte`
- Modify: `apps/web/messages/zh-TW.json`
- Modify: `apps/web/messages/en.json`
- Test: `tests/component/web/exam-draft-publish-guidance.test.ts`

**Interfaces:**

- Consumes: `data.isManager`, `detail.status`, `activeSubTabKey`, and `assessmentSubTabHref`.
- Produces: draft-specific hero status and manager-only guidance panel with a settings-tab publish link.

- [ ] Add failing assertions for draft status mapping, guidance copy, and a settings-tab link; include a non-manager case that does not render the guidance.
- [ ] Run the focused test and confirm it fails with the current `draft -> scheduled` mapping and absent guidance panel.
- [ ] Map draft to the shared `draft` status, add localized guidance copy, and render a manager-only panel with a primary link to `?tab=settings` and the existing publish action in `ExamSettingsTab`.
- [ ] Keep the draft hero from showing an active countdown label; retain configured schedule values for staff context.
- [ ] Run focused tests and the relevant component suite until green.

### Task 3: Verification and commit

**Files:**

- Modify: generated Paraglide output only if the repository workflow requires it.

- [ ] Run formatting/lint checks for touched files.
- [ ] Run the focused test and the repository CI verification command available in the environment.
- [ ] Review the diff for scope, copy parity, and manager-only visibility.
- [ ] Commit with `feat: clarify exam draft publish state`.
