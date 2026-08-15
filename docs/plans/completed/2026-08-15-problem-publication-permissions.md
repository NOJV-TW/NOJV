# Problem Publication Permissions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let every problem author publish a private problem while allowing teachers, admins, and active course TAs to publish public problems.

**Architecture:** Keep `status` and `visibility` independent. Add one application-domain capability for public publication and reuse it in problem updates and the editor loader; the database mutation remains the trust boundary.

**Tech Stack:** TypeScript, SvelteKit/Svelte 5, Prisma repositories, Vitest, Playwright.

---

### Task 1: Lock the permission contract with tests

**Files:**

- Modify: `tests/unit/domain/problem-mutations.test.ts`
- Create: `tests/unit/domain/problem-publication-permissions.test.ts`

**Steps:**

1. Add a failing test proving an ordinary student may publish an owned private problem with a current accepted reference solution.
2. Add failing capability tests proving an active course TA may publish publicly while an ordinary student may not.
3. Run the focused Vitest files and confirm they fail on the existing role-only guards.

### Task 2: Implement one shared public-publication capability

**Files:**

- Modify: `packages/application/src/problem/permissions.ts`
- Modify: `packages/application/src/problem/mutations.ts`
- Modify: `apps/web/src/routes/(app)/problems/[problemId]/edit/+page.server.ts`
- Modify: `apps/web/src/routes/(app)/problems/[problemId]/edit/+page.svelte`

**Steps:**

1. Add `canPublishPublicProblems(actor)`, returning true for platform teachers/admins or users with an active teacher/TA membership in a non-archived course.
2. In the update mutation, reject public visibility for callers without that capability, but allow `status: "published"` when the effective visibility is private.
3. Expose the capability to the editor as `publicVisibilityAllowed`; keep private-only enforcement in `BasicInfoTab` and remove it from the publish-button gate.
4. Run the focused tests and confirm they pass.

### Task 3: Align documentation and verify the user flow

**Files:**

- Modify: `docs/product/PRODUCT_SENSE.md`
- Modify: `tests/e2e/problems.test.ts`

**Steps:**

1. Document that all authors may publish private problems and active TAs may publish public problems.
2. Add an E2E assertion that a private student-authored problem can reach `published` after its reference solution is verified.
3. Run focused unit/integration/E2E tests, then `pnpm lint`, `pnpm format`, and `pnpm ci:verify`.
4. Commit, push, open the PR, wait for required CI, then merge/release and verify Flux, Helm, workloads, and public health endpoints.
