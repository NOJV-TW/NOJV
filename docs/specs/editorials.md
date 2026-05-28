# Feature: Community Editorials

Acceptance spec for problem editorials — community-contributed writeups
keyed by `(user, problem, language)`. Only users who have already solved
the problem can read or post editorials: "earn it before you see the
answer." Content is markdown, rendered through the shared
`MarkdownRenderer` pipeline (marked + DOMPurify + KaTeX).

## User Stories

- As a **student** who has solved a problem, I want to read editorials
  written by other students for different languages, so that I can
  compare alternative approaches after submitting my own.
- As a **student** who has solved a problem, I want to post an editorial
  with my solution and a markdown-formatted explanation, so that I can
  share my approach with the community.
- As a **student** with AC in multiple languages, I want one editorial
  per language, so that my C++ and my Python writeups can coexist.
- As a **student** who has NOT solved the problem, I should not see
  editorials — the tab shows a "solve this first" message instead.
- As a **student**, I want to revise my own editorial without creating a
  duplicate, so that I can fix typos or rewrite the explanation.

## Scope

### In scope

- `Editorial` model with unique constraint
  `(userId, problemId, language)`.
- GET `/api/problems/[id]/editorials` — lists all editorials for a
  problem when the viewer has AC AND the viewer is not currently inside
  a live event re-using the problem; otherwise 403. The event context
  is resolved server-side (`resolveActiveContextForUser`) — the client
  cannot supply or override it.
- POST `/api/problems/[id]/editorials` — upserts by
  `(userId, problemId, language)` when the poster passes the same
  AC + context gate; otherwise 403.
- PATCH `/api/editorials/[id]` — author or admin only; updates content /
  language. Same length + enum validation as POST.
- DELETE `/api/editorials/[id]` — author or admin only; soft-delete
  (`deletedAt = now()`). Soft-deleted rows are filtered out of every
  list / fetch path.
- POST `/api/editorials/[id]/reports` — file a report against an
  editorial (any authenticated user; one per `(editorial, reporter)`).
- Admin moderation queue at `/(app)/admin/content/editorial-reports` —
  list open reports, resolve (soft-deletes the editorial) or dismiss.
- `/(app)/problems/[problemId]/editorials` — paginated list page,
  AC-gated.
- `/(app)/editorials/[id]/edit` — edit page; 404 for non-author
  non-admin.
- Content validation: markdown, 10–50000 characters, `SupportedLanguage`
  enum.
- Render path: `marked.parse(content, { async: false })` →
  `DOMPurify.sanitize(..., PURIFY_CONFIG)` → Svelte `{@html}`.
- Editorial tab in `ProblemLeftPanel.svelte` — lazy-loads editorials
  when the tab is opened by a user with AC.
- Listing order: `createdAt desc`; rows include author
  `displayUsername` and `name`.
- Upsert semantics: a second POST from the same user in the same
  language overwrites `content` and bumps `updatedAt`; `id` and
  `createdAt` stay the same.

### Out of scope

- Likes / votes / bookmarks.
- Comments or threaded discussion on editorials.
- Teacher-curated "official" editorials — everything is community.
- Per-editorial revision history.
- Search / filter by tag within editorials.
- Per-language ordering (e.g. "promote C++ to the top for this
  viewer").
- Editorial analytics (views, saves, etc.).

## Acceptance Criteria

### AC gate — view

- GIVEN a student with zero `accepted` non-sample submissions on problem
  P,
  WHEN they GET `/api/problems/[id]/editorials`,
  THEN `ForbiddenError("Solve this problem first to view editorials.")`.
- GIVEN a student with ≥1 accepted submission on P,
  WHEN they GET the endpoint,
  THEN the response is `{ editorials: Editorial[] }` ordered
  `createdAt desc`.
- GIVEN an unknown problem id,
  WHEN the GET runs,
  THEN `NotFoundError("Problem not found.")` — the problem lookup and
  AC check run in parallel; `NotFoundError` takes precedence.

### AC gate — post

- GIVEN a student without AC on P,
  WHEN they POST an editorial,
  THEN `ForbiddenError("Solve this problem first to post an editorial.")`
  fires. The shared `requireProblemWithAc` helper takes an optional
  error-message override so the GET and POST paths can report
  action-appropriate copy while reusing the same gate.

### Context gate — live event re-using the problem

- GIVEN a student who AC'd problem P during past practice,
  AND a live contest C is currently running with `now < C.endsAt`,
  AND C contains P,
  AND the student is enrolled in C,
  WHEN they GET `/api/problems/[id]/editorials`,
  THEN the response is 403 (or empty list at the domain layer) — even
  though the URL pattern does not mention the contest. The context is
  resolved server-side via `resolveActiveContextForUser`; the client
  cannot bypass it by omitting or spoofing a `context` parameter.
- GIVEN the same student after `now >= C.endsAt`,
  WHEN they GET the endpoint,
  THEN the response is `{ editorials: Editorial[] }` — the contest gate
  has closed.
- GIVEN two overlapping live events for P (e.g. a contest ending at T1
  and an assignment closing at T2 > T1) where the student is enrolled
  in both,
  WHEN they GET the endpoint at `now < T1`,
  THEN the gate stays closed until **the latest-ending event** clears
  (`now >= T2`) — `resolveActiveContextForUser` picks the strictest
  gate.
- GIVEN a student who has already authored an editorial on P,
  WHEN they GET the endpoint during a live event re-using P,
  THEN the response succeeds — the author grandfather clause overrides
  the context gate (and the AC gate) so an author can always see their
  own writing.

### Payload validation

- GIVEN `content` shorter than 10 characters,
  WHEN the POST runs,
  THEN Zod `ValidationError` (422) — nothing is written.
- GIVEN `content` longer than 50000 characters,
  WHEN the POST runs,
  THEN Zod `ValidationError` — nothing is written.
- GIVEN `language` not in `SupportedLanguage`,
  WHEN the POST runs,
  THEN Zod `ValidationError`.

### Upsert semantics

- GIVEN a user U with no prior editorial on `(P, lang)`,
  WHEN they POST `{ content, language: lang }`,
  THEN a new `Editorial` row is inserted.
- GIVEN user U has `(P, cpp)` with content "old",
  WHEN they POST `{ content: "new", language: "cpp" }`,
  THEN the row's `content` becomes "new" and `updatedAt` advances. `id`
  and `createdAt` are preserved.
- GIVEN user U has `(P, cpp)` and posts `(P, python)`,
  WHEN the POST runs,
  THEN a second row is inserted — language is part of the unique key.
- GIVEN two concurrent POSTs from U for `(P, cpp)`,
  WHEN they race,
  THEN the composite unique constraint serializes them; one becomes an
  insert, the other an update; both return the latest state.

### Markdown rendering safety

- GIVEN an editorial containing `<script>alert(1)</script>`,
  WHEN the UI renders via `MarkdownRenderer`,
  THEN DOMPurify strips the script — only safe markup reaches the DOM.
- GIVEN KaTeX math `$x^2 + y^2 = z^2$`,
  WHEN rendered,
  THEN marked's math pipeline produces HTML that DOMPurify allows via
  the project's `PURIFY_CONFIG` KaTeX whitelist.
- GIVEN an `<a href="javascript:alert(1)">` link,
  WHEN rendered,
  THEN DOMPurify's default URI allowlist rejects the `javascript:`
  scheme and the anchor is stripped or neutered.

### UI behavior

- GIVEN the viewer lacks AC on P,
  WHEN the Editorial tab opens,
  THEN a "solve this first" message renders; no API fetch fires.
- GIVEN the viewer has AC,
  WHEN the tab opens for the first time,
  THEN `/api/problems/[id]/editorials` is fetched lazily. Subsequent
  tab toggles reuse cached state (no refetch).
- GIVEN the user is typing an editorial,
  WHEN `content.length < 10`,
  THEN the submit button is disabled.
- GIVEN a successful POST,
  WHEN it resolves,
  THEN the form clears and the editorial list reloads (picking up the
  author's new or revised entry).

### Moderation & reporting

- GIVEN any authenticated user and an editorial they did not write,
  WHEN they POST `/api/editorials/[id]/reports` with a non-empty
  `reason` (≤1000 chars), THEN an `EditorialReport` row is created with
  `status: 'open'` and the trimmed reason; the route returns `201`.
- GIVEN a user reporting their OWN editorial,
  WHEN `reportEditorial` runs, THEN `ValidationError` — you cannot
  report yourself.
- GIVEN a user who already reported editorial E,
  WHEN they report E again, THEN the
  `@@unique([editorialId, reportedByUserId])` constraint surfaces as
  `ConflictError`.
- GIVEN a missing or soft-deleted editorial,
  WHEN a report is filed, THEN `NotFoundError`.
- GIVEN a non-admin actor, WHEN `listEditorialReports` is called,
  THEN `ForbiddenError("Admin access required.")`. An admin gets the
  open reports newest-first, each joined to its editorial + reporter.
- GIVEN an admin resolving a report with `action: 'resolve'`,
  THEN the offending editorial is soft-deleted and the report moves to
  `status: 'resolved'` (`resolvedByUserId` + `resolvedAt` stamped).
- GIVEN an admin resolving with `action: 'dismiss'`,
  THEN the editorial is left intact and the report moves to
  `status: 'dismissed'`.

## Edge Cases & Failure Modes

- **Problem deleted while editorials exist**: `Editorial.problem` has
  `onDelete: Cascade` — rows are wiped with the problem.
- **User deleted**: `Editorial.user` has `onDelete: Cascade` — rows are
  wiped with the user.
- **AC earned, then the AC submission is rejudged to WA**: editorial
  access is gated by `canViewEditorials` — true when the viewer has an
  accepted submission OR has authored a (non-deleted) editorial for the
  problem. A viewer whose AC submissions are all overturned by a rejudge
  KEEPS access if they have already published an editorial there (the
  rejudge "grandfather" clause); a viewer who only ever read editorials
  loses access on the next fetch.
- **`SupportedLanguage` enum evolution**: adding a new language is
  additive — no migration impact. Removing a language (deprecating an
  old one) would orphan existing editorial rows in that language; a
  cleanup migration would be needed to hard-delete or remap them.
- **Content at maximum length (49999 chars)**: accepted. No UI
  truncation or paging; the entire block renders.
- **Rapid-fire POST from the same user**: the unique constraint
  serializes — no duplicate rows, no partial state.

## Implementation References

### Domain

- `packages/domain/src/editorial/queries.ts` — `hasUserAcProblem`,
  `canViewEditorials` (author grandfather OR AC + context-gate-open),
  `resolveActiveContextForUser` (server-side resolution of the
  strictest active event for the viewer; the client cannot supply a
  context), `listProblemEditorials`, `listEditorialsPage`,
  `getEditorialById`. `EditorialViewContext` is the discriminated union
  shared across the gate API.
- `packages/domain/src/editorial/mutations.ts` — `upsertEditorial`,
  `updateEditorial`, `softDeleteEditorial`.
- `packages/domain/src/editorial/reports.ts` — `reportEditorial`,
  `listEditorialReports`, `resolveEditorialReport`.
- `packages/db/src/repositories/editorial.ts` — `listByProblemId`,
  `listByProblemIdPaged`, `countByProblemId`, `findById`, `upsert`,
  `update`, `softDelete`. All read paths filter `deletedAt: null`.
- `packages/db/src/repositories/editorial-report.ts` —
  `editorialReportRepo` (`create`, `findById`, `listByStatus`,
  `updateStatus`).

### Schema

- `packages/db/prisma/schema/submission.prisma` — `Editorial` model with
  `@@unique([userId, problemId, language])`,
  `@@index([problemId, createdAt])`, and nullable `deletedAt` for
  soft-delete (migration `20260430000000_editorial_soft_delete`). Also
  `EditorialReport` (`@@unique([editorialId, reportedByUserId])`, enum
  `EditorialReportStatus`).

### Routes / API

- `apps/web/src/routes/api/problems/[id]/editorials/+server.ts` — GET
  (list) + POST (upsert); local `requireProblemWithAc()` gate;
  `editorialSubmitSchema` imported from `@nojv/core`.
- `apps/web/src/routes/api/editorials/[id]/+server.ts` — PATCH (update)
  - DELETE (soft-delete); author + admin gated via domain helpers.
- `apps/web/src/routes/api/editorials/[id]/reports/+server.ts` — POST a
  report (`editorialReportSchema`, returns `201`).
- `apps/web/src/routes/(app)/admin/content/editorial-reports/` — admin
  moderation queue page (list / resolve / dismiss).
- `apps/web/src/routes/(app)/problems/[problemId]/editorials/` —
  paginated list page (AC-gated).
- `apps/web/src/routes/(app)/editorials/[id]/edit/` — single-editorial
  edit form (author / admin only).
- `apps/web/src/lib/components/features/problem/layouts/ProblemLeftPanel.svelte`
  — Editorial tab, form, and list.
- `apps/web/src/lib/components/primitives/layout/MarkdownRenderer.svelte`
  — sanitized render pipeline.
- `apps/web/src/lib/utils/markdown.ts` — `marked` + `PURIFY_CONFIG`
  (KaTeX allowlist).

### Core schemas

- `packages/core/src/schemas/editorial.ts` — `editorialSubmitSchema`
  (create) and `editorialUpdateSchema` (partial PATCH), sharing the
  `content` 10–50000-char bound and the `language` enum.

### Tests

- `tests/unit/domain/editorial-queries.test.ts` — covers
  `hasUserAcProblem` true/false branches with the
  `status='accepted'` + `sampleOnly=false` filter and
  `upsertEditorial`'s composite-key payload forwarding (including
  the two-language coexistence call pattern).
- `tests/unit/domain/editorial-mutations.test.ts` — covers
  `getEditorialById` (missing / soft-deleted = null), `updateEditorial`
  (author-only / admin-can-edit-others / NotFoundError on tombstone),
  `softDeleteEditorial` (idempotent double-delete = NotFoundError).
- `tests/unit/domain/editorial-reports.test.ts` — covers
  `reportEditorial` (self-report / dup / soft-deleted rejections),
  `listEditorialReports` (admin-only), `resolveEditorialReport`
  (resolve soft-deletes, dismiss does not), and `canViewEditorials`.
- `tests/integration/domain/editorial-reports.test.ts` — the same
  moderation flow against a real DB, exercising the unique-constraint
  `ConflictError` and the resolve-time soft-delete.
- **Still missing**: route-level AC gate tests (403 for GET and POST
  without AC) and an integration test that round-trips an XSS payload
  through `MarkdownRenderer` to confirm DOMPurify strips it.
