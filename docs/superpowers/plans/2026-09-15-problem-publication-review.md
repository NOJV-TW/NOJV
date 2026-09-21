# Problem Public Publication Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline execution is selected for this task). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require TA-owned private problems to go through an administrator publication request while preserving request history and preventing duplicate pending requests.

**Architecture:** Add a transactional `ProblemPublicationRequest` aggregate that points at the private source and, after approval, the admin-owned public fork. Keep direct teacher/admin publication on the existing problem mutation path, but remove TA direct-public eligibility. Add application methods for request submission and admin review, then expose role-aware editor controls and a dedicated admin review tab.

**Tech Stack:** Prisma/PostgreSQL, TypeScript application repositories, SvelteKit server actions, Svelte 5, Paraglide messages, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-15-problem-publication-review-design.md`

## Global Constraints

- Preserve the private source and course links; public approval always creates an independent public fork.
- Keep all permission checks in application transactions; UI visibility is not authorization.
- Allow at most one `pending` request per problem, retain approved/rejected history, and allow resubmission after rejection.
- Approval uses the current source and reruns `assertProblemPublishable`; failed validation leaves the request pending.
- Do not reuse `adminMayPublish` for TA requests.
- Add English and Traditional Chinese messages for every new label, status, action, and error.
- Use existing audit, card, table, dialog, form-action, and pagination patterns rather than introducing a new UI framework.

---

### Task 1: Persist publication requests and repository operations

**Files:**

- Modify: `packages/db/prisma/schema/problem.prisma`
- Modify: `packages/db/prisma/schema/auth.prisma`
- Modify: `packages/db/prisma/schema/ops.prisma`
- Create: `packages/db/prisma/migrations/20260915000000_problem_publication_requests/migration.sql`
- Modify: `packages/db/src/repositories/problem-publication-request.ts`
- Modify: `packages/db/src/repositories/problem.ts`
- Modify: `packages/db/src/repositories/index.ts`
- Test: `tests/unit/infra/problem-publication-request-repository.test.ts`

**Interfaces:**

- Produce `ProblemPublicationRequestStatus` values `pending | approved | rejected`.
- Produce repository methods `createPending`, `findById`, `findPendingByProblemId`, `listPaged`, `lockById`, `approve`, and `reject`; transactional methods must accept `TransactionClient`.
- `listPaged` returns requester, source problem/owner, reviewer, and public fork summaries needed by the admin page.

- [ ] **Step 1: Add schema types and relations.**

  Add the enum and model from the design spec. Use explicit relation names for `requestedBy`, `reviewedBy`, source `problem`, and optional `publishedProblem`. Add `problemPublicationRequests` and `publishedPublicationRequest` relations to `Problem`, user-side request/review relations to `User`, a partial unique constraint/index for `problemId` while `status = pending`, and indexes on `(status, createdAt)` and `(problemId, createdAt)`. Add `problem_publication_approve` and `problem_publication_reject` to `AdminAuditAction`.

- [ ] **Step 2: Write the migration SQL.**

  Create the enum/table, foreign keys with `ON DELETE RESTRICT` for the source and `ON DELETE SET NULL` for reviewer/public fork, indexes, and a unique partial index equivalent to:

  ```sql
  CREATE UNIQUE INDEX "ProblemPublicationRequest_one_pending_key"
    ON "ProblemPublicationRequest" ("problemId")
    WHERE "status" = 'pending';
  ```

  Make the migration safe for the repository's PostgreSQL migration runner and avoid destructive changes.

- [ ] **Step 3: Implement repository methods.**

  `createPending` inserts a request and maps a unique-constraint race to the existing repository error convention. `findById` and `findPendingByProblemId` include the exact public summaries needed by application/UI consumers. `listPaged` orders pending first, then newest `createdAt`/`id`, and uses a cursor or bounded page size consistent with existing admin lists. `withTx(tx).lockById` uses `SELECT ... FOR UPDATE`; `approve` and `reject` update only rows still in `pending` state.

- [ ] **Step 4: Add repository unit tests and run them.**

  Add tests proving pending creation, one-pending filtering, approved/rejected updates, and request detail includes requester/source/reviewer/fork fields. Run:

  ```bash
  pnpm vitest run tests/unit/infra/problem-publication-request-repository.test.ts --project unit
  ```

  Expected: the new tests initially fail before implementation, then pass after the repository is complete.

- [ ] **Step 5: Generate and validate Prisma artifacts.**

  Run `pnpm db:generate` and `pnpm db:validate`. Confirm only generated/expected schema artifacts changed and `git diff --check` is clean.

- [ ] **Step 6: Commit the persistence slice.**

  ```bash
  git add packages/db/prisma/schema packages/db/prisma/migrations/20260915000000_problem_publication_requests packages/db/src/repositories/problem-publication-request.ts packages/db/src/repositories/problem.ts packages/db/src/repositories/index.ts tests/unit/infra/problem-publication-request-repository.test.ts
  git commit -m "feat: persist problem publication requests"
  ```

### Task 2: Enforce TA request permissions and transactional review

**Files:**

- Modify: `packages/application/src/problem/permissions.ts`
- Create: `packages/application/src/problem/publication-requests.ts`
- Modify: `packages/application/src/problem/index.ts`
- Modify: `packages/application/src/problem/mutations.ts`
- Modify: `packages/application/src/audit/index.ts` (only if the audit export needs wiring)
- Test: `tests/unit/domain/problem-publication-requests.test.ts`
- Test: `tests/unit/domain/problem-mutations.test.ts`
- Test: `tests/integration/db/problem-publication-request.test.ts`

**Interfaces:**

- Produce `canRequestPublicProblemPublication(actor, problem)` and keep `canPublishPublicProblems` limited to `admin | teacher`.
- Produce `requestPublicProblemPublication(actor, problemId): Promise<{ id: string; status: "pending" }>`.
- Produce `listPublicProblemPublicationRequests(actor, options)` for admins and `getPublicProblemPublicationRequest(actor, requestId)` for admins.
- Produce `approvePublicProblemPublication(actor, requestId): Promise<{ requestId: string; publishedProblemId: string }>` and `rejectPublicProblemPublication(actor, requestId, reviewNote?: string): Promise<{ requestId: string; status: "rejected" }>`.

- [ ] **Step 1: Write failing unit tests for direct TA denial and request lifecycle.**

  Extend the existing publication-permission tests with these behaviors:

  ```ts
  it("rejects a TA owner attempting direct public publication", async () => {
    await expect(
      updateProblemRecord(taOwner, problem.id, { visibility: "public" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("creates one pending request and allows a new request after rejection", async () => {
    await expect(requestPublicProblemPublication(taOwner, problem.id)).resolves.toMatchObject({
      status: "pending",
    });
    await expect(requestPublicProblemPublication(taOwner, problem.id)).rejects.toThrow(
      /pending/,
    );
    await rejectPublicProblemPublication(admin, firstRequestId, "Please fix the statement.");
    await expect(requestPublicProblemPublication(taOwner, problem.id)).resolves.toMatchObject({
      status: "pending",
    });
  });
  ```

  Also cover a non-owner co-editor, an ordinary student, a teacher, and a TA whose course membership is removed or archived.

- [ ] **Step 2: Run the new unit tests to verify the expected failures.**

  ```bash
  pnpm vitest run tests/unit/domain/problem-publication-requests.test.ts tests/unit/domain/problem-mutations.test.ts --project unit
  ```

  Expected: failures show the current TA direct-publication behavior and missing request functions.

- [ ] **Step 3: Implement permission split and request submission.**

  Change `canPublishPublicProblems` to return true only for admins/teachers. Add a TA-owner-only predicate that checks private visibility, active non-archived staff membership, and ownership. Implement request creation in a transaction that locks the source problem, rechecks the predicate, checks for an existing pending row, and creates the request without changing the source or forking.

- [ ] **Step 4: Implement admin query and review transactions.**

  Add admin-only guards. Approval must lock request then source, require `pending`, source private, and source owner equal to `requestedByUserId`; call `assertProblemPublishable`; call `forkProblemInTransaction` with `{ authorId: actor.userId, published: true, requirePublishedPublicSource: false }`; update request to approved with reviewer/time/fork ID; and record `problem_publication_approve`. Rejection must lock a pending request, set rejected/reviewer/time/note, and record `problem_publication_reject`. Preserve pending on publication-validation failure and never create a fork in that case.

- [ ] **Step 5: Add unit tests for review and concurrency boundaries.**

  Cover admin-only review, double approval rejection, stale source ownership/visibility, validation failure leaving pending, admin-owned fork, private source preservation, optional rejection note, and no second pending request. Run the focused unit command again and expect all tests to pass.

- [ ] **Step 6: Add real-database integration coverage.**

  Create source + TA membership + accepted reference; assert request insertion and unique pending constraint; reject and resubmit; approve and verify the source remains private with its course links while a published admin-owned fork is linked; and assert stale/invalid reference approval leaves request pending. Run:

  ```bash
  pnpm vitest run tests/integration/db/problem-publication-request.test.ts --project integration
  ```

- [ ] **Step 7: Commit the application slice.**

  ```bash
  git add packages/application/src/problem packages/application/src/audit tests/unit/domain/problem-publication-requests.test.ts tests/unit/domain/problem-mutations.test.ts tests/integration/db/problem-publication-request.test.ts
  git commit -m "feat: route TA public publication through review"
  ```

### Task 3: Add role-aware editor submission UI

**Files:**

- Modify: `apps/web/src/routes/(app)/problems/[problemId]/edit/+page.server.ts`
- Modify: `apps/web/src/routes/(app)/problems/[problemId]/edit/+page.svelte`
- Modify: `apps/web/src/messages/en.json`
- Modify: `apps/web/messages/zh-TW.json`
- Test: `tests/unit/web/problem-publication-review.test.ts`
- Test: `tests/e2e/problems.test.ts`

**Interfaces:**

- Page data exposes `permissions.canRequestPublicPublication`, `publicationRequest` summary, and `publicationRequestError` when a prior request was rejected.
- Add form action `requestPublicPublication` that invokes the application method and returns the request ID/status.

- [ ] **Step 1: Write failing web tests for role-specific controls.**

  Add server-load/action tests proving a TA owner receives a request action, a teacher/admin owner retains direct public publication, a non-owner TA sees neither action, a pending request disables submission, and a rejected request permits resubmission while showing the note.

- [ ] **Step 2: Run the web tests to verify they fail.**

  ```bash
  pnpm vitest run tests/unit/web/problem-publication-review.test.ts --project unit
  ```

- [ ] **Step 3: Add page-load request state and action.**

  Load the latest request for the problem, derive the TA-owner request permission, and add `requestPublicPublication` through `problemEditAction`. Map conflict/permission errors to SvelteKit action failures without exposing stack traces.

- [ ] **Step 4: Render the correct editor action.**

  Keep the existing direct public-copy action only when `canPublishPublicCopy` is true for teacher/admin owners. For TA owners, render a `Submit for public review` button and pending/rejected status. Use the existing confirmation dialog/form enhancement patterns; never send `visibility: public` from the TA action.

- [ ] **Step 5: Add English and Traditional Chinese messages.**

  Add labels and copy for request submission, pending, approved, rejected, review note, duplicate pending, request confirmation, and success/error to both message catalogs. Keep the existing public-copy strings for direct teacher/admin publication.

- [ ] **Step 6: Run web tests and the existing problem E2E subset.**

  ```bash
  pnpm vitest run tests/unit/web/problem-publication-review.test.ts --project unit
  pnpm exec playwright test tests/e2e/problems.test.ts --grep "publication|publish"
  ```

  Expected: role-specific controls and request action pass without changing teacher/admin direct publication behavior.

- [ ] **Step 7: Commit the editor slice.**

  ```bash
  git add apps/web/src/routes/'(app)'/problems/'[problemId]'/edit apps/web/messages tests/unit/web/problem-publication-review.test.ts tests/e2e/problems.test.ts
  git commit -m "feat: add TA publication request editor flow"
  ```

### Task 4: Build the administrator review page

**Files:**

- Create: `apps/web/src/routes/(app)/admin/problem-publications/+page.server.ts`
- Create: `apps/web/src/routes/(app)/admin/problem-publications/+page.svelte`
- Modify: `apps/web/src/routes/(app)/admin/+layout.svelte`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/zh-TW.json`
- Test: `tests/unit/web/admin-problem-publications.test.ts`
- Test: `tests/e2e/admin-problem-publications.test.ts`

**Interfaces:**

- `load` returns paged requests with requester/source/reviewer summaries and active status filter.
- Actions `approve` and `reject` accept `requestId`; `reject` also accepts an optional `reviewNote`.

- [ ] **Step 1: Write failing admin route/UI tests.**

  Test that non-admins receive 403, admins see pending/history rows, approval calls the domain method, rejection persists the note, and stale/validation errors are shown without changing the row to approved.

- [ ] **Step 2: Run the tests to verify they fail.**

  ```bash
  pnpm vitest run tests/unit/web/admin-problem-publications.test.ts --project unit
  ```

- [ ] **Step 3: Implement the admin server route.**

  Follow `/admin/reports` and existing list routes: require admin, parse `status`/page parameters, call application queries, and wrap approve/reject actions with `withAction`. Return safe failure messages and invalidate the page after success.

- [ ] **Step 4: Implement the admin page.**

  Add an admin navigation tab, pending/history filter, table columns for source, requester, submitted time, status, reviewer/note, and public fork. Make rows keyboard accessible. Add inspect/detail dialog with links to the private source and public fork; approval uses confirmation, rejection uses a reason field and confirmation.

- [ ] **Step 5: Add translated admin copy and status styling.**

  Reuse existing table/filter/card/dialog primitives and map pending/approved/rejected to distinct accessible status labels and colors in both locales.

- [ ] **Step 6: Run route/UI tests and the focused E2E.**

  ```bash
  pnpm vitest run tests/unit/web/admin-problem-publications.test.ts --project unit
  pnpm exec playwright test tests/e2e/admin-problem-publications.test.ts
  ```

- [ ] **Step 7: Commit the admin slice.**

  ```bash
  git add apps/web/src/routes/'(app)'/admin/problem-publications apps/web/src/routes/'(app)'/admin/+layout.svelte apps/web/messages tests/unit/web/admin-problem-publications.test.ts tests/e2e/admin-problem-publications.test.ts
  git commit -m "feat: add admin publication request review"
  ```

### Task 5: Documentation and full verification

**Files:**

- Modify: `docs/product/PRODUCT_SENSE.md`
- Modify: `docs/plans/active/2026-09-08-problem-permissions.md`
- Modify: `docs/architecture/FRONTEND.md`
- Modify: `docs/architecture/DATABASE.md`

- [ ] **Step 1: Update policy documentation.**

  Replace the direct-publication statement for TAs with the request/review flow, document request history/one-pending semantics, and add the admin route and model to the architecture references.

- [ ] **Step 2: Run formatting and repository checks.**

  ```bash
  pnpm format
  pnpm lint:doc-drift
  pnpm lint:migrations
  pnpm typecheck:tests
  pnpm test:unit
  pnpm test:component
  ```

  Expected: all commands exit 0; fix formatting or type errors before continuing.

- [ ] **Step 3: Run focused application and web verification.**

  ```bash
  pnpm vitest run tests/unit/domain/problem-publication-requests.test.ts tests/unit/domain/problem-mutations.test.ts --project unit
  pnpm vitest run tests/integration/db/problem-publication-request.test.ts --project integration
  pnpm vitest run tests/unit/web/problem-publication-review.test.ts tests/unit/web/admin-problem-publications.test.ts --project unit
  ```

- [ ] **Step 4: Review the complete diff and migration.**

  Run `git diff origin/main...HEAD --check`, inspect the migration for rollback safety and foreign-key direction, verify no generated secrets or unrelated files are included, and confirm the working tree only contains intended changes.

- [ ] **Step 5: Commit documentation and verification updates.**

  ```bash
  git add docs/product/PRODUCT_SENSE.md docs/plans/active/2026-09-08-problem-permissions.md docs/architecture/FRONTEND.md docs/architecture/DATABASE.md
  git commit -m "docs: describe problem publication review policy"
  ```

- [ ] **Step 6: Run the final CI-equivalent command before handoff.**

  ```bash
  pnpm ci:verify
  ```

  Expected: formatting, lint, build, typecheck, unit, and component checks pass. If an environment-only dependency fails, capture the exact command/output and report it separately from code failures.
