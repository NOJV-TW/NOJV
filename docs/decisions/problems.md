# Problems and submissions decisions

Durable decisions for the problem model, authoring, publication, ownership, and the submission lifecycle outside the judge itself. Read the relevant entries before planning a change here; a change that contradicts an entry must say so and update or replace the entry in the same PR. Current mechanics live in [Judge Pipeline](../architecture/JUDGE_PIPELINE.md), [Database Schema](../architecture/DATABASE.md) and [Product Sense](../product/PRODUCT_SENSE.md).

### PRB-01 Three problem types; workspace files instead of templates

**Decided:** 2026-04 · **Source:** [2026-04-09-problem-ui-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-09-problem-ui-redesign.md), [2026-04-12-codebase-cleanup-audit](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-12-codebase-cleanup-audit.md), [2026-05-12-full-source-system-templates-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-12-full-source-system-templates-design.md), [2026-04-01-cp-problem-judge-mapping](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-01-cp-problem-judge-mapping.md)

Problem types are `full_source`, `multi_file` and `special_env`. `multi_file` problems use `ProblemWorkspaceFile` (problem, language, path) with whole-file visibility `editable`/`readonly`/`hidden`; the server merges the student's editable files with the rest and judges the whole tree. `full_source` accepts every supported language with system `LANGUAGE_TEMPLATES` starters and no teacher starters. One model covers single-file, fill-in-function, library and multi-file problems without hidden wrapping code.

- Rejected: a LeetCode-style `function` type with `driverCode`, insertion markers, `editableRegions` or `assembleSource` templates (use `multi_file` plus a readonly driver); per-file editable regions; letting workspace files decide `full_source` languages; function-mode, custom-script and score-stage judge kits. Nondeterministic or subjective course tasks get deterministic statements or manual grading instead of new judge modes.
- Rule: no insertion markers or driver injection; students submit whole editable files.
- Rule: workspace-file requirements and language filtering apply only when `type === "multi_file"`.
- Code: `packages/core/src/types.ts`, `packages/application/src/problem/details.ts`, `packages/core/src/language-templates.ts`

### PRB-02 Judge settings live in one validated `judgeConfig` JSON column

**Decided:** 2026-04 · **Source:** [2026-04-03-problem-config-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-03-problem-config-redesign.md), [2026-04-03-problem-config-implementation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-03-problem-config-implementation.md), [2026-05-27-problems-filter-sidebar](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-27-problems-filter-sidebar.md)

Eight scattered judge columns became one Zod-validated `Problem.judgeConfig` (type, checker/interactor language, compare, runtime). The schema was fragmented with no single validated source.

- Rejected: separate columns per judge feature; a denormalized `judgeType` column for filtering (filters read `judgeConfig.type`).
- Rule: validate through `judgeConfigSchema` in `@nojv/core`; a null config or missing `type` means `standard`.
- Code: `packages/core/src/schemas/judge-config.ts`, `packages/db/prisma/schema/problem.prisma`

### PRB-03 Samples are presentation data, not testcases

**Decided:** 2026-04 · **Source:** [2026-04-09-problem-ui-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-09-problem-ui-redesign.md)

Sample input/output pairs live in `Problem.samples` (JSON); every `TestcaseSet` is a graded subtask with weight > 0. Samples are problem presentation, not grading data.

- Rejected: samples as a flagged, hidden or zero-weight `TestcaseSet` (`isHidden` was removed).
- Rule: do not reintroduce sample flags on `TestcaseSet`; sample-only runs read `Problem.samples`.
- Code: `packages/db/prisma/schema/problem.prisma`

### PRB-04 Testcase and workspace content live in object storage behind versioned pointers

**Decided:** 2026-04 · **Source:** [2026-04-13-testcase-blob-storage-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-13-testcase-blob-storage-design.md)

Testcase input/output/aux files and workspace file contents live in `@nojv/storage`; rows hold JSON pointers (`inputStorage`, `contentStorage`) to immutable `.../versions/{v}/...` keys verified by size and SHA-256. Large TEXT rows inflated queries, backups and edit payloads.

- Rejected: overwrite-in-place keys with plain `*Key` columns (original plan); wrapping S3 I/O in a Prisma transaction (holds a pooled connection over network I/O); deleting blobs before the DB row; multipart, presigned client upload or inline small-file storage.
- Rule: upload blobs before committing pointers; never hold a DB transaction across object-storage I/O.
- Rule: the DB is the source of truth; blob cleanup follows DB deletion through durable cleanup, and forks share pointers.
- Rule: build keys only in `packages/storage/src/keys.ts`.
- Code: `packages/storage/src/keys.ts`, `packages/application/src/shared/storage-object-lifecycle.ts`

### PRB-05 Problem images are public objects referenced from Markdown

**Decided:** 2026-04 · **Source:** [2026-04-06-image-upload-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-06-image-upload-design.md)

Editors paste or drop images, which upload via `POST /api/problems/[id]/images` to `problems/{problemId}/images/{uuid}.{ext}` in S3-compatible storage (MinIO locally, GCS/R2/S3 by env); the public URL goes into the Markdown. Provider-agnostic and needs no schema change.

- Rule: png, jpeg, gif and webp only, at most 5 MB, magic bytes checked, problem-edit permission required.
- Rule: problem image paths are publicly readable; never store secret material there.
- Code: `packages/storage/src/images.ts`, `apps/web/src/routes/api/problems/[id]/images/+server.ts`

### PRB-06 Author uploads have a per-problem budget and safe bundle import

**Decided:** 2026-05 · **Source:** [2026-05-28-storage-unification-and-uploads](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-28-storage-unification-and-uploads.md)

Upload routes require API auth, problem-edit access and the write rate limiter; each problem has a 50 MB storage budget. Zip bundles hold only testcases, workspace files and checker/interactor, with at most 200 entries and 50 MB uncompressed, rejecting `..` and absolute paths. Author convenience without resource exhaustion or path traversal.

- Code: `packages/application/src/problem/storage-budget.ts`, `packages/application/src/problem/bundle.ts`

### PRB-07 `displayId` is for display only; URLs keep the cuid

**Decided:** 2026-05 · **Source:** [2026-05-10-problem-display-id-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-10-problem-display-id-design.md), [2026-05-10-problem-display-id](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-10-problem-display-id.md)

Problems show a global integer `#N` via `formatProblemDisplayName`; routes, params, foreign keys and keyed lists use the cuid. Truncated cuids mean nothing to users, while cuids resist enumeration. The number is allocated server-side under a lock on first publication.

- Rejected: `/problems/42` URLs or any displayId-to-cuid lookup API; per-author or per-course numbering; client-chosen ids.
- Rule: never route by or expose a lookup by `displayId`; create/update schemas must not accept it.
- Code: `apps/web/src/lib/utils/format-problem-display-name.ts`, `packages/application/src/problem/mutations/publishing.ts`

### PRB-08 Draft lifecycle and server-enforced publish/delete guards

**Decided:** 2026-04 · **Source:** [2026-04-03-problem-config-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-03-problem-config-redesign.md), [2026-06-12-full-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-12-full-audit-remediation.md), [2026-07-07-system-health-check-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-07-system-health-check-remediation.md), [2026-09-09-draft-delete](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-09-draft-delete.md)

New problems start as `draft` (students may only create private drafts) so authors can configure judging before anyone sees them. Published problems never revert to draft; only unused drafts can be deleted, and completed practice reference submissions are deleted with them (storage cleanup enqueued atomically). Contest/exam/assessment/course problem links are `onDelete: Restrict` because `Submission.problem` still cascades and an unpublish-then-delete could wipe a live contest's submissions.

- Rejected: route-only or client-only (`canPublish`) checks, which a tampered POST bypasses; letting reference submissions block draft deletion.
- Rule: status changes only through the dedicated publish action; draft-save schemas omit `status`; `assertProblemPublishable` runs server-side in the domain.
- Rule: deleting a linked problem returns a ConflictError, not a raw P2003; ordinary submissions, active judging, activity links and audit history still block deletion.
- Rule: lock submission rows during draft delete to fence concurrent rejudge; UI treats SvelteKit HTTP-200 action failures as failures.
- Code: `packages/application/src/problem/mutations/records.ts`, `packages/application/src/problem/mutations/publishing.ts`

### PRB-09 Publication requires a private, current reference solution

**Decided:** 2026-08 · **Source:** [2026-08-08-reference-solution-validation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-08-08-reference-solution-validation.md), [2026-08-15-reference-validation-editor-form](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-08-15-reference-validation-editor-form.md)

A standard problem publishes only with an accepted reference solution for the current judge configuration, authored in the editor's "Reference solution" section. It is an ordinary practice submission flagged `isReferenceSolution` against the full testcase set, pointed to by `Problem.referenceSolutionSubmissionId`, and tied to the problem's storage generation so any judge-affecting edit invalidates it. It validates the testcase and judge contract, not correctness.

- Rejected: a separate route or modal; ZIP upload; auto-generated editorials; review queues or approval states; schema defaults for time/memory limits (required fields).
- Rule: reference source is never public and never appears in lists or history; only owner or admin may read it directly.
- Rule: only authorized publishers submit with the reference purpose; hidden workspace files are never exposed in the section.
- Rule: invalidation covers testcases, workspace files, judge config/checker/interactor, languages/type, limits and advanced config.
- Code: `packages/application/src/problem/mutations/publishing.ts`, `packages/db/prisma/schema/submission.prisma`

### PRB-10 Personal ownership, course sharing and forks

**Decided:** 2026-09 · **Source:** [2026-09-08-problem-permissions](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-08-problem-permissions.md), [2026-08-15-problem-forks-admin-visibility](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-08-15-problem-forks-admin-visibility.md)

Every problem has one personal owner (`authorId`, `ON DELETE RESTRICT`). `CourseProblem` shares a problem with a course, and bound, active teachers/TAs of a non-archived course co-edit the private problems shared with it. Forks are independent private drafts with `forkedFromProblemId` lineage made by one transactional deep copy; public problems added to a course are forked into an importer-owned private copy.

- Rejected: course-owned problems; a generic ACL, per-problem collaborator lists or library roles; fork synchronization, merge or pending-review systems; auto-reassigning owners.
- Rule: authorization uses separate can-read, can-edit, owner-only management and target-course-usable checks; co-edit never grants sharing, self-fork, visibility or consent changes, bundle export or deletion. Pending roster rows grant nothing.
- Rule: content mutations recheck the actor inside the transaction, locking Course, CourseMembership, CourseProblem before Problem; fork + library + activity writes commit atomically, and storage-reference accounting stays consistent on rollback.
- Rule: `resolveActivityProblems` keeps existing DB references (never client-claimed IDs), never re-forks an actor-owned problem, and reuses existing private copies.
- Rule: unsharing is refused while activities reference the problem; account deletion requires explicit ownership handover.
- Code: `packages/application/src/course/problem-library.ts`, `packages/application/src/problem/fork.ts`, `packages/application/src/problem/permissions.ts`

### PRB-11 Visibility, public publication and admin consent

**Decided:** 2026-08 · **Source:** [2026-08-15-problem-publication-permissions](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-08-15-problem-publication-permissions.md), [2026-08-08-reference-solution-validation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-08-08-reference-solution-validation.md), [2026-09-08-problem-permissions](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-08-problem-permissions.md)

`status` and `visibility` are independent. Any author may publish a private problem; public publication needs `canPublishPublicProblems` (platform teacher/admin, or active teacher/TA in a non-archived course) and creates a publisher-owned public fork, leaving the private source intact. `adminMayPublish` is the owner's one-time consent, consumed on use, for an admin to publish a non-owned problem; it never makes a problem discoverable or implies review. Students can author privately without an implied review promise.

- Rejected: a review queue, pending status or moderation dashboard (admins use an "All problems" tab); labelling consent as "Public"; teachers/TAs reviewing student problems.
- Rule: the database mutation is the trust boundary; admin authority uses the effective admin-mode role.
- Code: `packages/application/src/problem/mutations/publishing.ts`, `packages/application/src/problem/permissions.ts`

### PRB-12 special_env uses teacher-built, digest-pinned images in `advancedConfig`

**Decided:** 2026-07 · **Source:** [2026-07-12-special-env-image-ref](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-12-special-env-image-ref.md), [2026-07-13-release-preflight](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-13-release-preflight.md), [2026-06-14-advanced-judge-run-grade-split-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-14-advanced-judge-run-grade-split-design.md)

`Problem.advancedConfig` (Zod JSON, like `judgeConfig`) holds run, grade and optional service images, network mode and `maxScore`. Teachers build their own images and reference them as `@sha256:` digests from `ADVANCED_IMAGE_ALLOWED_REGISTRIES`. Creating special_env needs admin-granted `User.canCreateAdvancedProblems`; publishing needs an accepted test run with the exact configured images, after which judge settings are immutable. The k8s web pod has no docker and any verified account could reach a build path.

- Rejected: flat `advancedImageRef` columns; tarball/ZIP uploads built in the web pod (2026-06 design); an NOJV image build service; a human review queue; cosign or Kyverno.
- Rule: digest and allowlist checks apply at the input layer (create/draft schema, import), never in base `advancedConfigSchema`, so stored configs keep parsing on the judge read path.
- Rule: enforce the permission wherever `type` can become `special_env`; co-editors may keep already-approved identical digests, new images validate against the actor.
- Rule: `Submission.advancedConfigSnapshot` is audit only, never a judging input.
- Code: `packages/core/src/schemas/advanced-mode.ts`, `apps/web/src/lib/server/advanced-image-config.ts`

### PRB-13 special_env required paths are static literals

**Decided:** 2026-05 · **Source:** [2026-05-06-advanced-required-paths](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-06-advanced-required-paths.md)

`Problem.advancedRequiredPaths` lists literal relative paths (trailing `/` = folder must exist), checked by one pure `@nojv/core` validator in the browser and again on the server. Wrong ZIP structure produced cryptic compile errors and forced defensive judge scripts.

- Rejected: globs, optional markers, forbidden patterns, content/regex checks and "no extra files" (content-shape checks belong in the judge image).
- Rule: non-`special_env` problems must have an empty list; paths are relative, no `..`, `[A-Za-z0-9._-/]`, ≤256 chars, ≤50 entries; files match exactly, folders by prefix.
- Rule: the server always re-validates.
- Code: `packages/core/src/schemas/required-paths.ts`, `packages/application/src/submission/creation.ts`

### PRB-14 Problem library search and filters

**Decided:** 2026-05 · **Source:** [2026-05-27-problems-filter-sidebar](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-27-problems-filter-sidebar.md), [2026-06-10-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-10-audit-remediation.md), [2026-06-11-post-audit-next-phase](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-11-post-audit-next-phase.md)

Filters live in URL params, combine with AND, and status is one of solved/attempted/untried/bookmarked; status counts cover the public published base set ignoring other filters, for signed-in users only. Any judge-method filter excludes `special_env`. Search runs full-text first and LIKE only when that returns nothing.

- Rejected: parallel FTS + LIKE on every query; a `to_tsvector` GIN index (Prisma cannot express it, breaking the zero-drift migration gate); cursor pagination; saved filter presets.
- Rule: do not add raw-SQL-only indexes the Prisma schema cannot express.
- Rule: bookmarks are `ProblemBookmark`, unique per (user, problem).
- Code: `packages/application/src/problem/list.ts`

### PRB-15 Submission creation commits an outbox row, then dispatches immediately

**Decided:** 2026-08 · **Source:** [2026-08-06-immediate-judge-dispatch](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-08-06-immediate-judge-dispatch.md), [2026-08-21-ui-and-reliability-fixes](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-08-21-ui-and-reliability-fixes.md)

A submission commits with a transactional outbox row, then makes an awaited best-effort Temporal start; the durable-work processor is recovery, not the latency path. `judge-{submissionId}` is the concurrency fence and `WorkflowExecutionAlreadyStarted` is success. The response stays `202 { submissionId, pollUrl, status }`.

- Rejected: marking a committed submission `system_error` because immediate dispatch failed.
- Rule: outbox first, then dispatch; a dispatch failure leaves the submission queued, and acceptance never manufactures SE.
- Code: `packages/application/src/submission/creation.ts`

### PRB-16 Stuck submissions sweep to `system_error`, which never costs an attempt

**Decided:** 2026-06 · **Source:** [2026-06-10-stale-submission-reaper](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-10-stale-submission-reaper.md), [2026-06-10-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-10-audit-remediation.md)

A per-minute cron workflow moves non-terminal submissions whose `updatedAt` exceeds `SUBMISSION_PENDING_TIMEOUT_MINUTES` (default 10) to `system_error` with a status-guarded update, skipping those whose judge workflow is still running. `system_error` is excluded from attempt counts. Dead workers had left submissions stuck and burned attempts.

- Rejected: an admin-tunable `PlatformSetting` (2026-06, replaced by env); terminating workflows from the sweeper; lazy detection; a new status enum value; Temporal Schedule API; staleness by `createdAt` (rejudges requeue old rows).
- Rule: platform faults never use up attempts; status changes are guarded by the current status.
- Code: `packages/application/src/submission/sweep.ts`, `packages/db/src/repositories/submission/history.ts`

### PRB-17 Operation authority follows the submission's context

**Decided:** 2026-04 · **Source:** [2026-04-19-rejudge-and-score-override-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-19-rejudge-and-score-override-design.md), [2026-04-19-rejudge-and-score-override-plan](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-19-rejudge-and-score-override-plan.md)

Rejudge and score operations share one matrix: practice by admins and the problem author; assignment/exam by admins and that course's teachers/TAs; contest by admins and the organizer. The problem author has no authority over submissions made inside an activity.

- Rule: a batch rejudge must be authorized for every matched submission or is rejected whole.
- Rule: a batch without a context scope is limited to the problem author and reaches only practice submissions.
- Code: `packages/application/src/submission/permissions.ts`

### PRB-18 Rejudge logs are summaries, idempotent per run, kept 90 days

**Decided:** 2026-06 · **Source:** [2026-06-10-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-10-audit-remediation.md), [2026-06-12-full-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-12-full-audit-remediation.md)

`SubmissionRejudgeLog` stores a verdict summary, is upserted on `@@unique([submissionId, rejudgeRunId])` so retries keep the original `oldVerdict`, and is swept after 90 days. Full detail bloated the table and retries duplicated rows.

- Rule: Temporal activities that write rows must be idempotent under retry.
- Code: `packages/db/prisma/schema/submission.prisma`, `packages/application/src/submission/sweep.ts`

### PRB-19 Submission views never expose graded testcase data

**Decided:** 2026-05 · **Source:** [2026-05-12-submission-detail-redesign-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-12-submission-detail-redesign-design.md), [2026-05-27-submission-unification-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-27-submission-unification-design.md)

No view shows expected output or diffs. Students see per-case stdout/stderr only on sample runs (`sampleOnly`); graded cases show verdict, time and memory only. Hidden testdata must not leak through submissions.

- Rule: never render expected output; strip stdout, stderr and staffFeedback from graded student results via `sanitizeStudentResult`.
- Code: `packages/application/src/submission/scoring.ts`, `apps/web/src/lib/components/features/submission/CaseResultGrid.svelte`

### PRB-20 Context-explicit solve routes and one case-result schema

**Decided:** 2026-05 · **Source:** [2026-05-27-submission-unification-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-27-submission-unification-design.md)

Practice, assignment, contest and exam keep separate route trees because the path tags the submission context and the exam lock depends on the `/exams/[examId]` boundary; `/submissions/[id]` is the staff review and student self-view. One `caseResultSchema` (verdict string, no `passed` flag) serves both `caseResults` and `subtaskResults`, and verdict styling comes only from `verdict-style.ts`.

- Rejected: collapsing everything into `/problems/[id]`; merging the two result containers; compatibility layers or data migrations for pre-production cutovers.
- Rule: never mix other contexts' submissions into a contest or exam workspace; list rows carry a context tag.
- Code: `packages/core/src/schemas/submission.ts`, `apps/web/src/lib/utils/verdict-style.ts`, `packages/application/src/submission/history.ts`

### PRB-21 Closed activities become practice without touching grades

**Decided:** 2026-04 · **Source:** [2026-04-16-practice-after-close-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-16-practice-after-close-design.md)

After an assignment, contest or exam ends, its participants can view and solve its problems as practice at `/problems/[id]`; scores stay frozen because practice submissions carry no context. `assertProblemViewAccess` grants this to historical participants of ended, published activities, and closed contest/assignment problem routes redirect there.

- Rejected: a `late` column in the grade matrix; post-close plagiarism re-scans.
- Rule: post-close submissions carry no activity context; the API still rejects expired context.
- Rule: never open during an ongoing exam (even after finishing early), for draft/unpublished activities, or to non-participants.
- Code: `packages/application/src/problem/permissions.ts`

### PRB-22 Status and judge generation drive submission tracking

**Decided:** 2026-09 · **Source:** [2026-09-21-submission-history](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-21-submission-history.md)

Tracking belongs to the authenticated session (SSE wakeups, 5 s visible polling, bounded reads) keyed on status and `judgeGeneration`, not on whether a result exists; pending rejudges hide previous scores and terminal errors need no result file. Workspace history appends batches of 50; teacher/standalone lists use numbered 50-row pages with stable scoped snapshots and a new-submission prompt.

- Rejected: a new state package or DB table; a permanent notification panel.
- Rule: requests bind to the current context and late responses must not overwrite a newer one; background refresh preserves filters, pagination and unsaved grading edits.
- Rule: browser rejudge-progress responses expose only status and counts.
- Code: `packages/application/src/submission/history.ts`

### PRB-23 The server holds the draft of record for editor code

**Decided:** 2026-09 · **Source:** [2026-09-23-server-code-drafts](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-09-23-server-code-drafts.md)

`CodeDraft` keyed by (user, contextKey, problem, language) holds unsubmitted code; the browser keeps only unacknowledged edits sealed with a per-user AES-GCM key and deletes them once acknowledged. Contexts (`practice`, `assignment:`, `exam:`, `contest:`, `virtual:`) never share drafts. Plain localStorage lost exam code on shared lab PCs and could leak it to the next user.

- Rejected: server-side encryption at rest (access control is the boundary); staff visibility of drafts.
- Rule: owner-only access; exam drafts need an active exam session on a published, not-ended exam containing the problem, and an active exam session sees only that exam's drafts.
- Rule: drafts use their own rate limiter, never the submission budget; no pushes after a failed initial load; last write wins.
- Code: `packages/db/prisma/schema/submission.prisma`, `apps/web/src/routes/api/drafts/+server.ts`, `apps/web/src/lib/services/draft-sync.ts`
