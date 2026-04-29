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
  problem when the viewer has AC; otherwise 403.
- POST `/api/problems/[id]/editorials` — upserts by
  `(userId, problemId, language)` when the poster has AC; otherwise 403.
- PUT `/api/editorials/[id]` — author or admin only; updates content /
  language. Same length + enum validation as POST.
- DELETE `/api/editorials/[id]` — author or admin only; soft-delete
  (`deletedAt = now()`). Soft-deleted rows are filtered out of every
  list / fetch path.
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
- Flag / report workflow for inappropriate content.
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

## Edge Cases & Failure Modes

- **Problem deleted while editorials exist**: `Editorial.problem` has
  `onDelete: Cascade` — rows are wiped with the problem.
- **User deleted**: `Editorial.user` has `onDelete: Cascade` — rows are
  wiped with the user.
- **AC earned, then the AC submission is rejudged to WA**: the viewer
  retains visibility within the current session since `hasUserAcProblem`
  is a point-in-time `exists()` check at request time. Next fetch
  re-evaluates — if all of U's AC submissions on P are overturned, the
  editorial list becomes inaccessible again.
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

- `packages/domain/src/problem/editorial-queries.ts` —
  `hasUserAcProblem`, `upsertEditorial`, `listEditorialsPage`,
  `getEditorialById`, `updateEditorial`, `softDeleteEditorial`.
- `packages/db/src/repositories/editorial.ts` — `listByProblemId`,
  `listByProblemIdPaged`, `countByProblemId`, `findById`, `upsert`,
  `update`, `softDelete`. All read paths filter `deletedAt: null`.

### Schema

- `packages/db/prisma/schema/submission.prisma` — `Editorial` model with
  `@@unique([userId, problemId, language])`,
  `@@index([problemId, createdAt])`, and nullable `deletedAt` for
  soft-delete (migration `20260430000000_editorial_soft_delete`).

### Routes / API

- `apps/web/src/routes/api/problems/[id]/editorials/+server.ts` — GET
  (list) + POST (upsert); local `requireProblemWithAc()` gate and
  inline `editorialSubmitSchema`.
- `apps/web/src/routes/api/editorials/[id]/+server.ts` — PUT (update)
  - DELETE (soft-delete); author + admin gated via domain helpers.
- `apps/web/src/routes/(app)/problems/[problemId]/editorials/` —
  paginated list page (AC-gated).
- `apps/web/src/routes/(app)/editorials/[id]/edit/` — single-editorial
  edit form (author / admin only).
- `apps/web/src/lib/components/problem/ProblemLeftPanel.svelte` —
  Editorial tab, form, and list.
- `apps/web/src/lib/components/layout/MarkdownRenderer.svelte` —
  sanitized render pipeline.
- `apps/web/src/lib/markdown.ts` — `marked` + `PURIFY_CONFIG`
  (KaTeX allowlist).

### Core schemas

- `editorialSubmitSchema` is defined inline at the route level (not in
  `@nojv/core`). Constraints: `content: z.string().min(10).max(50000)`,
  `language: languageSchema`.

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
- **Still missing**: route-level AC gate tests (403 for GET and POST
  without AC) and an integration test that round-trips an XSS payload
  through `MarkdownRenderer` to confirm DOMPurify strips it.

## Open Questions / TODO

- No moderation surface beyond admin soft-delete. If bad-actor
  editorials (spam, vent posts) become a real problem, admin can
  hard-delete via DB; in-product moderation queue still missing.
- `editorialSubmitSchema` lives at the route level; promoting it to
  `@nojv/core` would be consistent with other schemas once the domain
  module grows.
- Visibility loss after mass rejudge: if a problem's test cases change
  and the viewer's AC is overturned, their editorial list access
  silently disappears. No mitigation today.
