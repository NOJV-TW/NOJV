# Feature: Problem Posts (Editorials & Discussions)

Acceptance spec for problem posts — community-contributed articles
attached to a problem. One `ProblemPost` model carries two types:
`editorial` (solution writeups, gated behind solving the problem:
"earn it before you see the answer") and `discussion` (open Q&A,
any signed-in user). Both types share titles, markdown content,
up/down votes, two-level comments, and a unified report → admin
moderation pipeline. Content is markdown, rendered through the shared
`MarkdownRenderer` pipeline (marked + DOMPurify + KaTeX). The entire
experience lives inside the problem workspace left panel — there are
no standalone post pages.

## User Stories

- As a **student** who has solved a problem, I want to read editorials
  written by other students, so that I can compare alternative
  approaches after submitting my own.
- As a **student** who has solved a problem, I want to publish multiple
  editorials (each with its own title), so that I can write up distinct
  approaches separately.
- As a **student** who has NOT solved the problem, I should not see
  editorials — the tab shows a "solve this first" lock instead.
- As a **signed-in student**, I want to open a discussion thread on any
  problem I can access, so that I can ask questions before solving it.
- As a **reader**, I want to upvote/downvote posts and sort the list by
  votes, so that the best writeups surface first.
- As a **reader**, I want to comment on a post and reply to a comment
  (one level deep), so that threads stay readable.
- As a **user**, I want to report an offensive post or comment, so that
  an admin can review and remove it.
- As an **admin**, I want a single moderation queue for all reported
  content, so that I can resolve (remove) or dismiss reports in one
  place.
- As a **contest/exam participant**, I must not be able to read or write
  posts for a problem while the event is live — no answer leaks.

## Scope

### In scope

- `ProblemPost` model (`type: editorial | discussion`, `title`,
  `content`, soft-delete via `deletedAt`); a user may author any number
  of posts per problem.
- `PostVote` (`@@unique([postId, userId])`, `value` +1/-1) with a
  `voteScore` aggregate and per-viewer `viewerVote` in list/detail
  responses.
- `PostComment` — two levels only (top-level comment + reply whose
  `parentId` must point at a top-level comment); soft-delete renders a
  tombstone ("This comment has been deleted") while replies stay.
- `ContentReport` — one report per `(post, reporter)` or
  `(comment, reporter)`; exactly one of `postId` / `commentId` set;
  `open → resolved | dismissed`.
- GET `/api/problems/[id]/posts?type=editorial|discussion&page&pageSize&sort=new|top`
  — paginated list; `top` sorts by vote score server-side. View gate per
  type (below); admins bypass the view gate.
- POST `/api/problems/[id]/posts` — create a post (`type`, `title`
  1–200 chars, `content` 10–50000 chars); same interact gate.
- GET/PATCH/DELETE `/api/posts/[id]` — read one post (view-gated),
  edit (author or admin), soft-delete (author or admin).
- POST `/api/posts/[id]/votes` — cast/replace/clear a vote (+1/-1/0);
  not on your own post.
- GET/POST `/api/posts/[id]/comments` — list comments (view-gated;
  deleted rows returned as `deleted: true` with empty content) and add
  a comment/reply (1–5000 chars).
- DELETE `/api/comments/[id]` — soft-delete a comment (author or
  admin).
- POST `/api/posts/[id]/reports`, POST `/api/comments/[id]/reports` —
  file a report (`reason` 1–1000 chars, trimmed non-empty).
- Admin moderation queue at `/(app)/admin/reports` — lists open reports
  with target type (editorial / discussion / comment), content preview,
  reporter, and reason; resolve soft-deletes the target and notifies
  its author (`post_removed` / `comment_removed`); dismiss only closes
  the report. Both actions write an admin audit row
  (`content_report_resolve` / `content_report_dismiss`).
- In-panel UI: the problem workspace left panel gains Discussions and
  Editorials tabs (tab order: Description, Submissions, Discussions,
  Editorials) with list → article → compose views inside the panel.
- Server-side context gate: every post/comment/vote/report endpoint is
  403 while a live contest / assignment / exam containing the problem
  is running for the actor (`resolveActiveContextForUser`); the exam
  confinement hook additionally blocks `/api/posts/*`,
  `/api/comments/*`, and `/api/problems/[id]/posts` during an active
  exam session.
- Content validation: markdown, `content` 10–50000 chars, `title`
  1–200 chars (trimmed).
- Render path: `marked.parse(content, { async: false })` →
  `DOMPurify.sanitize(..., PURIFY_CONFIG)` → Svelte `{@html}`.

### Out of scope

- Nested comment threads deeper than two levels.
- Comment editing (post, delete — nothing else).
- Report categories/taxonomy; notifying the reporter of the outcome.
- Anonymous / signed-out reading of discussions.
- Teacher-curated "official" editorials — everything is community.
- Per-post revision history.
- Search / filter by tag within posts.
- Post analytics (views, saves, etc.).
- Standalone post pages (`/problems/[id]/editorials`,
  `/editorials/[id]/edit` were removed) — the panel is the only surface.

## Acceptance Criteria

### View gate — editorial

- GIVEN a student with zero `accepted` non-sample submissions on problem
  P and no authored post on P,
  WHEN they GET `/api/problems/[id]/posts?type=editorial`,
  THEN `ForbiddenError("Solve this problem first to view editorials.")`.
- GIVEN a student with ≥1 accepted submission on P,
  WHEN they GET the endpoint,
  THEN the response is `{ items, total, page, pageSize }`.
- GIVEN a student who has authored a (non-deleted) editorial post on P
  (even without a current AC — e.g. their AC was overturned by a
  rejudge),
  WHEN they GET the endpoint,
  THEN the response succeeds — authors keep access to the surface where
  their own writing lives.
- GIVEN an admin without AC on P,
  WHEN they GET the endpoint,
  THEN the response succeeds — admins bypass the view gate (read
  access for moderation).
- GIVEN an unknown problem id,
  WHEN the GET runs,
  THEN `NotFoundError("Problem not found.")`.

### View gate — discussion

- GIVEN any signed-in student, with or without AC on P,
  WHEN they GET `/api/problems/[id]/posts?type=discussion`,
  THEN the response succeeds — discussions only require authentication.
- GIVEN an unauthenticated request,
  WHEN any posts/comments endpoint runs,
  THEN 401 — every endpoint sits behind `requireApiAuth`.

### Interact gate — create / vote / comment / report

- GIVEN a student without AC on P,
  WHEN they POST `{ type: "editorial", ... }`,
  THEN `ForbiddenError("Solve this problem first to post an editorial.")`.
- GIVEN the same student,
  WHEN they POST `{ type: "discussion", ... }`,
  THEN the post is created — discussion writes need only a signed-in
  user (and an open context gate).
- Voting, commenting, and reporting on a post all re-run the same
  per-type gate against the post's problem — a user who cannot view a
  post cannot interact with it either.

### Context gate — live event re-using the problem

- GIVEN a student who AC'd problem P during past practice,
  AND a live contest C is currently running with `now < C.endsAt`,
  AND C contains P and the student is enrolled in C,
  WHEN they call any posts endpoint for P (either type, read or write),
  THEN 403 — the context is resolved server-side via
  `resolveActiveContextForUser`; the client cannot supply or spoof it,
  and entering via the practice URL does not bypass it.
- GIVEN the same student after `now >= C.endsAt`,
  WHEN they GET the endpoint,
  THEN the response succeeds — the gate has closed.
- GIVEN two overlapping live events for P (e.g. a contest ending at T1
  and an assignment closing at T2 > T1) where the student is enrolled
  in both,
  WHEN they GET the endpoint at `now < T1`,
  THEN the gate stays closed until **the latest-ending event** clears
  (`now >= T2`) — the resolver picks the strictest deadline.
- GIVEN a post author enrolled in a live contest containing P,
  WHEN they GET editorial posts during the contest,
  THEN 403 — the context gate is checked before the author exception;
  authorship does not open a live event.
- GIVEN a student inside an active exam session,
  WHEN they request `/api/posts/*`, `/api/comments/*`, or
  `/api/problems/[id]/posts` for ANY problem,
  THEN the exam confinement hook (`hooks.server.ts` exam lock) rejects
  the request before it reaches the route — defense in depth over the
  per-problem context gate.

### Payload validation

- GIVEN `content` shorter than 10 or longer than 50000 characters,
  WHEN a post create/update runs,
  THEN Zod `ValidationError` (422) — nothing is written.
- GIVEN a missing/empty `title` or a title longer than 200 characters,
  WHEN the POST runs,
  THEN Zod `ValidationError`.
- GIVEN a comment body that is empty after trimming or longer than 5000
  characters,
  WHEN the comment POST runs,
  THEN Zod `ValidationError`.
- GIVEN a PATCH with neither `title` nor `content`,
  WHEN it runs,
  THEN Zod `ValidationError` ("At least one field ... required").

### Post lifecycle

- GIVEN an author U with an existing post,
  WHEN U PATCHes new `title`/`content`,
  THEN the row updates and `updatedAt` advances; a PATCH whose values
  equal the current ones is a no-op returning the existing row.
- GIVEN a non-author non-admin actor,
  WHEN they PATCH or DELETE the post,
  THEN `ForbiddenError` — author or admin only.
- GIVEN an author or admin,
  WHEN they DELETE the post,
  THEN `deletedAt` is stamped (soft-delete); the post disappears from
  every list/detail path; a second DELETE returns `NotFoundError`.

### Votes

- GIVEN a viewer with an open gate and someone else's post,
  WHEN they POST `{ value: 1 }` then `{ value: -1 }` then `{ value: 0 }`,
  THEN their single vote row is created, flipped, and cleared —
  `@@unique([postId, userId])` guarantees one vote per user; the
  response carries the new aggregate `score` and `viewerVote`.
- GIVEN the post's own author,
  WHEN they vote on it,
  THEN `ForbiddenError("You cannot vote on your own post.")`.

### Comments

- GIVEN a viewer with an open gate,
  WHEN they POST a comment without `parentId`,
  THEN a top-level comment is created (201).
- GIVEN a top-level comment,
  WHEN a reply is POSTed with `parentId` set to it,
  THEN the reply is created.
- GIVEN a reply (a comment that itself has `parentId`),
  WHEN a second-level reply targets it,
  THEN `ValidationError("Replies cannot be nested deeper than one level.")`.
- GIVEN a `parentId` that does not exist or belongs to another post,
  WHEN the POST runs,
  THEN `ValidationError("Parent comment not found.")`.
- GIVEN the comment author or an admin,
  WHEN they DELETE the comment,
  THEN it is soft-deleted; the list endpoint still returns the row with
  `deleted: true` and empty content so the UI can render the tombstone
  and keep the reply thread intact.

### Markdown rendering safety

- GIVEN a post containing `<script>alert(1)</script>`,
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

### In-panel UI behavior

- GIVEN the practice problem workspace,
  WHEN it renders,
  THEN the left panel tabs are Description, Submissions, Discussions,
  Editorials; contest/exam/assignment workspaces do not render the
  Discussions/Editorials tabs at all (`postsEnabled` stays false — the
  API gate above is the real barrier, the hidden tab is the second
  layer).
- GIVEN a viewer without AC,
  WHEN the Editorials tab opens,
  THEN a lock message ("solve this first") renders and no list fetch
  fires; the Discussions tab loads normally for the same viewer.
- GIVEN the list view,
  WHEN it renders,
  THEN rows show title, author, vote score, comment count, and time,
  with Latest / Top voted sorting and paging; opening a row swaps the
  panel to the article view (markdown content, vote buttons, report
  dialog, comment thread, back-to-list), and the compose view is a
  title + markdown form in the same panel.
- GIVEN the Discussions list and compose form,
  WHEN they render,
  THEN a spoiler hint line ("Please do not spoil the answer or post
  complete solutions in discussions.") is shown.
- GIVEN a deleted comment,
  WHEN the thread renders,
  THEN the tombstone "This comment has been deleted." appears in its
  place; deleted posts simply vanish from the list.

### Reporting & moderation

- GIVEN any gate-open user and a post or comment they did not write,
  WHEN they POST a report with a non-empty `reason` (≤1000 chars),
  THEN a `ContentReport` row is created with `status: 'open'` and the
  trimmed reason; the route returns 201.
- GIVEN a user reporting their OWN post or comment,
  WHEN `reportContent` runs,
  THEN `ForbiddenError` — you cannot report yourself.
- GIVEN a user who already reported target T,
  WHEN they report T again,
  THEN the per-target unique constraint surfaces as
  `ConflictError("You have already reported this content.")`.
- GIVEN a missing or soft-deleted target,
  WHEN a report is filed,
  THEN `NotFoundError`.
- GIVEN a non-admin actor,
  WHEN `listContentReports` or `resolveContentReport` is called,
  THEN `ForbiddenError("Admin access required.")`. An admin gets the
  open reports newest-first, each joined to its target + reporter.
- GIVEN an admin resolving a report with `action: 'resolve'`,
  THEN the offending post or comment is soft-deleted, the author
  receives a `post_removed` / `comment_removed` notification (linking
  back to the problem), and the report moves to `status: 'resolved'`
  (`resolvedByUserId` + `resolvedAt` stamped). If the target was
  already deleted, no duplicate notification fires.
- GIVEN an admin resolving with `action: 'dismiss'`,
  THEN the target is left intact and the report moves to
  `status: 'dismissed'`.
- GIVEN a report that is no longer `open`,
  WHEN an admin acts on it again,
  THEN `ConflictError("This report has already been handled.")`.

## Edge Cases & Failure Modes

- **Problem or user deleted while posts exist**: `ProblemPost.problem`
  and `.author` both have `onDelete: Cascade` — posts (and their votes,
  comments, and reports, also cascading) are wiped with the parent.
- **AC earned, then the AC submission is rejudged to WA**: editorial
  access is `authored-editorial OR AC` — a viewer whose AC submissions
  are all overturned KEEPS access if they have already published an
  editorial there (the rejudge "grandfather" clause); a viewer who only ever read
  editorials loses access on the next fetch.
- **Comment on a deleted post**: `NotFoundError` — the post lookup runs
  before the comment insert.
- **Report against a comment whose parent post was hard-deleted**: the
  cascade removes the report row too; the admin queue never shows
  orphans (targets resolved via joins).
- **Content at maximum length (49999 chars)**: accepted. No UI
  truncation or paging; the entire block renders.
- **`sort=top` with new votes racing the fetch**: top sort loads all
  non-deleted posts for the problem and sorts in the application layer —
  page boundaries may shift between fetches; acceptable for the
  expected per-problem volume.

## Implementation References

### Domain

- `packages/application/src/post/queries.ts` — `hasUserAcProblem`,
  `canViewPosts` (discussion: gate-open; editorial: gate-open AND
  (authored OR AC)), `resolveActiveContextForUser` (server-side
  strictest-deadline resolution), `listPostsPage`, `getPostById`.
  `PostViewContext` is the discriminated union shared across the gate
  API.
- `packages/application/src/post/mutations.ts` — `createPost`,
  `updatePost`, `softDeletePost`, `castPostVote`,
  `assertCanInteractWithPosts`, `assertAuthorOrAdmin`.
- `packages/application/src/post/comments.ts` — `addComment`,
  `softDeleteComment`, `listComments`.
- `packages/application/src/post/reports.ts` — `reportContent`,
  `listContentReports`, `resolveContentReport` (resolve → soft-delete +
  `post_removed` / `comment_removed` notification).
- `packages/db/src/repositories/post.ts`, `post-vote.ts`,
  `post-comment.ts`, `content-report.ts`. All read paths filter
  `deletedAt: null` (comments are the exception — they surface deleted
  rows for tombstones).

### Schema

- `packages/db/prisma/schema/submission.prisma` — `ProblemPost`
  (`@@index([problemId, type, createdAt])`), `PostVote`
  (`@@unique([postId, userId])`), `PostComment` (self-relation
  `parentId`), `ContentReport` (`@@unique([postId, reportedByUserId])`
  - `@@unique([commentId, reportedByUserId])`, DB CHECK: exactly one
    target column set via `ContentReport_target_check`), enums
    `ProblemPostType` / `ContentReportStatus`. Migration
    `20260712000000_problem_posts` renames the legacy `Editorial` /
    `EditorialVote` / `EditorialReport` tables in place (existing rows
    become `type = 'editorial'` posts, with the old `language` folded
    into the title where none existed).

### Routes / API

- `apps/web/src/routes/api/problems/[id]/posts/+server.ts` — GET (list,
  paged + sorted) + POST (create).
- `apps/web/src/routes/api/posts/[id]/+server.ts` — GET / PATCH /
  DELETE.
- `apps/web/src/routes/api/posts/[id]/votes/+server.ts` — POST a vote.
- `apps/web/src/routes/api/posts/[id]/comments/+server.ts` — GET / POST
  comments.
- `apps/web/src/routes/api/comments/[id]/+server.ts` — DELETE a
  comment.
- `apps/web/src/routes/api/posts/[id]/reports/+server.ts`,
  `.../api/comments/[id]/reports/+server.ts` — POST a report (201).
- `apps/web/src/lib/server/post-access.ts` —
  `requireProblemPostAccess` / `requireViewablePost` route-layer gate
  helpers (admin bypass lives here).
- `apps/web/src/lib/server/exam-lock.ts` — exam confinement forbids
  `/api/posts/`, `/api/comments/`, and `/api/problems/[id]/posts`
  during an active exam session.
- `apps/web/src/routes/(app)/admin/reports/` — unified admin moderation
  queue (list / resolve / dismiss + admin audit).
- `apps/web/src/lib/components/features/problem/left-panel/PostPanel.svelte`
  - `apps/web/src/lib/components/features/posts/` (`PostListView`,
    `PostArticleView`, `PostForm`) — in-panel list / article / compose.
- `apps/web/src/lib/components/primitives/layout/MarkdownRenderer.svelte`
  — sanitized render pipeline.

### Core schemas

- `packages/core/src/schemas/post.ts` — `problemPostTypeSchema`,
  `postListSortSchema`, `postSubmitSchema`, `postUpdateSchema`,
  `postVoteSchema`, `postCommentSubmitSchema`, `contentReportSchema`,
  and the list-response schemas shared with the panel.

### Tests

- `tests/unit/domain/post-queries.test.ts`,
  `post-context-gate.test.ts`, `post-resolve-context.test.ts` — view
  gate, author exception, strictest-deadline context resolution.
- `tests/unit/domain/post-mutations.test.ts`, `post-votes.test.ts`,
  `post-comments.test.ts` — lifecycle, author/admin checks, vote
  rules, two-level nesting limit, tombstones.
- `tests/unit/domain/content-reports.test.ts` +
  `tests/integration/domain/content-reports.test.ts` — report
  validation, dedupe `ConflictError`, resolve/dismiss flow with
  notifications against a real DB.
- `tests/unit/web/exam-confinement-api-allowlist.test.ts` +
  `exam-lock.test.ts` — posts/comments APIs blocked during exam
  confinement.
- `tests/integration/web/markdown-renderer-xss.test.ts` —
  server-renders `MarkdownRenderer` with an XSS payload and verifies
  DOMPurify strips executable nodes and attributes.
- `tests/e2e/editorials.test.ts` — route-level gates plus the in-panel
  discussion and editorial happy paths (create, comment, reply, vote,
  report, tombstone, delete).
