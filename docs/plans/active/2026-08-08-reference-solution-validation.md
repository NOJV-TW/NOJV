# Reference Solution Validation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Require every standard problem draft to pass a full judge run with an author-provided reference solution before publication, while allowing students to keep private problems and explicitly authorize an admin to publish them later.

**Architecture:** Add a `Reference solution` section to the existing problem editor rail. The section reuses `MonacoScriptEditor` for single-file problems and the existing workspace file list/editor for multi-file problems; it is a solution overlay, not a second problem-workspace editor. A validated reference submission is stored as a private problem-owned artifact, and any judge-affecting problem change invalidates it. Public visibility remains separate from a small `admin may publish` authorization flag; there is no review queue or approval state.

**Tech Stack:** SvelteKit, Svelte 5, Monaco, Bits UI, Paraglide JS, Zod, Prisma, `@nojv/application`, existing submission/judge pipeline, Vitest, Playwright.

---

## Product and UI decisions

### Role policy

- **Student:** may create and edit own private drafts, open the solve workspace, run and submit solutions, and validate the reference solution; cannot publish public problems.
- **Teacher / TA:** may publish their own problems according to the existing staff permissions; they do not review or publish another user's student-owned private problem.
- **Admin:** may browse all problems, edit any problem, and publish a student-owned private problem only when the student has enabled `Allow admin to publish`.
- There is no submission inbox, pending-review status, reviewer assignment, or expectation that an admin inspects every private problem.

### Existing editor navigation

- Add one rail item named `Reference solution` after `Judge` and before publish actions.
- Keep the current `/problems/[problemId]/edit` route and `ProblemSections` section-switching model.
- Show a compact status marker in the rail:
  - empty: `Not configured`
  - dirty after judge-affecting edits: `Needs revalidation`
  - running: `Validating`
  - accepted: `Verified`
  - failed: `Failed`
- Publish remains in the existing rail action area. Its disabled explanation names the missing gate instead of forcing the user to guess which tab is incomplete.

### Visibility and authorization UI

- Keep `visibility` as the visibility concept: `private` or `public`. Do not rename `public` to mean permission; visibility and authorization are different concepts.
- Integrate a two-option segmented control into the existing `Basic Info` surface rather than adding a new rail item or admin-only page. For student authors, the options are:
  - `Private` — only the author can access and solve the problem;
  - `Allow admin to publish this problem` — the problem remains private now, but the author grants admin permission to publish it later.
- Do not label the second option `Public`: selecting it must not change `visibility` to `public` and must not make the problem discoverable.
- For teacher/admin authors, retain the existing `Private` / `Public` selector because they can publish their own problems directly.
- The student control defaults to `Private`. The helper text must state that authorization does not submit the problem for review and does not guarantee that an admin will publish it.

### Admin discovery surface

- Do not create an admin moderation dashboard or review queue.
- On the existing `/problems` page, add an admin-only `All problems` tab beside the existing public / my-problems tabs.
- The tab lists draft, private, public, and published problems with lightweight filters for owner, status, visibility, and `admin may publish`.
- The row action opens the existing problem editor. The admin's explicit `Publish as public` action shows the authorization state and reference-solution status before confirming.

### Single-file problems

- Render the existing `MonacoScriptEditor` with the selected allowed language.
- Provide `Reset` and `Validate reference solution` actions only; do not add a second code-paste workflow.
- Show the latest verdict/result inline below the editor, including failed testcase summary and a link back to the relevant judge configuration when applicable.

### Multi-file problems

- Reuse the existing `WorkspaceFileList` and `WorkspaceFileEditor` composition.
- Seed the reference solution from the current problem workspace once, with a clear `Use current workspace` action if no reference draft exists.
- `editable` files are editable; `readonly` files are visible but locked; `hidden` files are not exposed to the author solution editor and remain platform-owned.
- Hide file path, visibility, add-file, and delete-file controls in reference mode. Those controls belong to problem workspace authoring, not solution authoring.
- The solution submits the same merged file tree that students submit, so the author validates the real multi-file contract.

### Deliberately skipped in v1

- No separate reference-solution route or modal editor.
- No ZIP upload flow; it would add a second representation before the shared editor is proven useful.
- No automatic public Editorial post. The reference source stays private; an Editorial remains an explicit human-authored post.
- No review workflow, submission inbox, reviewer assignment, pending queue, or admin audit dashboard.
- No claim that one accepted reference solution proves mathematical correctness; it validates the test/judge contract.

## Implementation tasks

### Task 1: Add the private reference-solution domain contract

**Files:**

- Modify: `packages/db/prisma/schema/problem.prisma`
- Modify: `packages/db/prisma/schema/submission.prisma`
- Modify: `packages/core/src/schemas/submission.ts`
- Modify: `packages/application/src/submission/mutations.ts`
- Modify: `packages/application/src/submission/queries.ts`
- Modify: `packages/application/src/problem/mutations.ts`
- Create: `packages/db/prisma/migrations/<timestamp>_reference_solution_validation/migration.sql`
- Test: `tests/integration/web/reference-solution-validation.test.ts`

**Steps:**

1. Add a private reference-solution identity to the existing submission model and a problem-owned pointer to the currently verified submission. Do not create a parallel source-storage system.
2. Add a problem-level `adminMayPublish` authorization flag, defaulting to false for student-created problems. Keep it separate from `visibility` and do not add a review-status enum.
3. Add a submission request purpose that distinguishes reference validation from ordinary student submissions. Only the problem owner, teacher, or admin may use it; it must not be accepted from a normal student request.
4. Reuse the existing source storage and judge workflow. Reference submissions must use practice context, cannot be attached to contests/assignments/exams, and must run against the complete testcase set rather than sample-only cases.
5. Add an application query returning the reference status and latest validation result for the edit page. Keep reference submissions out of ordinary student-facing submission lists.
6. Add an invalidation helper and call it from every mutation that changes judge behavior: testcase input/output, workspace files, judge config/checker/interactor, language/type, time limit, memory limit, and advanced configuration where applicable.
7. Make publication reject a draft without a current accepted reference solution. Return a specific conflict code/message so the UI can focus the rail and explain the blocker.
8. Add a separate permission path for an admin publishing a student-owned problem. Require `adminMayPublish`; keep ordinary edit and own-problem publication permissions separate from this action.
9. Add integration coverage for student authorization, admin-only cross-owner publication, teacher/TA denial for student-owned publication, accepted/failed validation, stale invalidation, publication rejection, and private source access.

### Task 2: Reuse the existing editor pipeline for reference code

**Files:**

- Modify: `apps/web/src/lib/services/submission-service.ts`
- Modify: `apps/web/src/lib/components/features/problem/editors/editor-bindings.ts`
- Modify: `apps/web/src/lib/components/features/problem/editors/use-editor-run.svelte.ts`
- Create: `apps/web/src/lib/components/features/problem/reference/ReferenceSolutionSection.svelte`
- Create: `apps/web/src/lib/components/features/problem/reference/ReferenceSolutionResult.svelte`
- Modify: `apps/web/src/routes/(app)/problems/[problemId]/edit/+page.server.ts`

**Steps:**

1. Extend the existing submission request only enough to carry the reference purpose; keep `buildSubmissionRequest` as the single source of truth for full-source and multi-file payload projection.
2. Add a small reference controller that dispatches a full validation and polls through the existing submission service. Do not fork the worker judge or create a second polling protocol.
3. Implement `ReferenceSolutionSection.svelte` with two branches:
   - full source: language selector plus `MonacoScriptEditor`;
   - multi file: existing workspace list/editor with reference-mode flags.
4. Reuse existing verdict styling and result components where possible. Show a loading state, accepted state, failed state, and system-error retry state.
5. Load the reference status, stored source, allowed languages, and workspace files from the existing edit page load. Keep hidden files out of the reference editor payload.
6. Add explicit copy explaining that validation checks the judge/testcase contract and does not publish the source.

### Task 3: Add the rail section and publication checklist

**Files:**

- Modify: `apps/web/src/lib/components/features/problem/views/ProblemSections.svelte`
- Modify: `apps/web/src/routes/(app)/problems/[problemId]/edit/+page.svelte`
- Modify: `apps/web/src/lib/components/features/problem/views/EditRail.svelte` only if the existing action slot cannot express the status card
- Modify: `apps/web/src/lib/paraglide/messages/en.json`
- Modify: `apps/web/src/lib/paraglide/messages/zh-TW.json`
- Test: `tests/e2e/problem-lifecycle.test.ts`
- Test: `tests/e2e/workspace-multifile.test.ts`

**Steps:**

1. Add `reference` to the existing section list and render it through the current snippet-based section API.
2. Add reference status to the existing completion logic. Basic information must still unlock the section, but reference validation should be the only new publication blocker for standard problems.
3. Add the role-aware two-option publication segmented control to the existing Basic Info surface; do not create a separate permissions page.
4. Replace the current binary standard-mode `testcaseSets.length > 0` publish condition with the server-provided current-reference status. Keep the server-side gate authoritative.
5. Add a publish checklist row for `Reference solution verified`, with a direct navigation action to the section when incomplete.
6. Add the admin-only `All problems` tab to the existing problems listing, reusing the current list/card grammar and filters rather than creating an admin moderation surface.
7. Keep the rail compact: no nested menu, no new top-level page, and no duplicate save controls for problem structure.
8. Add English and Traditional Chinese strings for labels, statuses, helper text, authorization copy, errors, and publish blockers.
9. Verify the rail, visibility control, admin list tab, editor, status card, and disabled publish state in both light and dark themes, at desktop and narrow desktop widths. Preserve existing tokens and focus-ring behavior.

### Task 4: Verify end-to-end behavior

**Files:**

- Modify: `tests/e2e/problem-lifecycle.test.ts`
- Modify: `tests/e2e/workspace-multifile.test.ts`
- Create: `tests/integration/domain/reference-solution.test.ts`
- Modify: `docs/architecture/JUDGE_PIPELINE.md`
- Modify: `docs/architecture/DATABASE.md`
- Modify: `docs/product/PRODUCT_SENSE.md`

**Steps:**

1. Add a student test: a private draft is visible to its author, the author can solve/test it, and the problem is absent from the public list.
2. Add a standard single-file draft test: publication is blocked, reference validation with a correct program passes, then an authorized publisher can publish it.
3. Add a failure test: a reference program receiving WA/TLE/CE leaves the problem unpublished and exposes the latest result.
4. Add a stale test: change a testcase or judge setting after verification; the rail becomes `Needs revalidation` and publish is blocked until a new accepted run.
5. Add a multi-file test: the reference editor shows the same file tree, editable files accept changes, readonly files stay locked, hidden files stay absent, and the submitted payload matches the student contract.
6. Add role tests: teacher/TA cannot publish a student-owned private problem; admin can see it in `All problems` and can publish only after `adminMayPublish` is enabled.
7. Add a security test: a non-owner cannot create or read another author's reference source, and ordinary students never see it in submission history or APIs.
8. Run the focused integration and E2E tests, then `pnpm lint`, `pnpm format`, and the relevant typecheck/build command.
9. If UI files are changed, run the Impeccable detector once over the changed targets:
   `node /Users/takala/.codex/plugins/cache/impeccable/impeccable/4.0.4/skills/impeccable/scripts/detect.mjs --json <changed-targets>`.

## Acceptance criteria

- A standard draft cannot publish without an accepted current reference solution.
- The reference solution is never public and is excluded from ordinary submission history.
- Students can keep private problems, solve/test them, and explicitly authorize admin publication without submitting a review request.
- There is no review queue and no promise that an admin will inspect or publish every private problem.
- Only admin can publish another user's student-owned private problem; teacher/TA do not review it.
- Visibility and `admin may publish` are separate concepts and are presented inside the existing Basic Info UI.
- Admin discovers all problems through the existing problems page's admin-only `All problems` tab.
- Single-file and multi-file problems use the same section and validation action.
- Multi-file reference editing reuses the problem workspace tree and exposes no hidden files.
- Any judge-affecting change makes the previous verification stale.
- The server, not only the disabled button, enforces the publication gate.
- No automatic Editorial post is created from the reference source.
