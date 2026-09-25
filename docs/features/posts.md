# Feature: Problem Posts (Editorials and Discussions)

Acceptance spec for community posts on a problem. One `ProblemPost` model has two types: `editorial` (visible after solving) and `discussion` (any signed-in user). Both have titles, Markdown content, votes, two-level comments and reports feeding one admin moderation queue. Everything lives in the practice workspace's left panel; there are no standalone post pages. Decisions: UI-04, UI-05, UI-06.

## Key code

- `packages/application/src/post/queries.ts` — `hasUserAcProblem`, `contextGateOpen`, `canViewPosts`, `resolveActiveContextForUser`, `listPostsPage`, `getPostById`
- `packages/application/src/post/mutations.ts` — `createPost`, `updatePost`, `softDeletePost`, `castPostVote`, `assertCanInteractWithPosts`, `assertAuthorOrAdmin`
- `packages/application/src/post/comments.ts`, `post/reports.ts` — comments; `reportContent`, `listContentReports`, `resolveContentReport`
- `packages/db/src/repositories/post.ts`, `post-vote.ts`, `post-comment.ts`, `content-report.ts`
- `packages/core/src/schemas/post.ts` — request and list-response schemas
- `packages/db/prisma/schema/submission.prisma` — `ProblemPost`, `PostVote`, `PostComment`, `ContentReport` (`ContentReport_target_check`), enums `ProblemPostType`, `ContentReportStatus`
- `apps/web/src/lib/server/post-access.ts` — `requireProblemPostAccess`, `requireViewablePost` (admin bypass)
- API: `apps/web/src/routes/api/problems/[id]/posts/`, `api/posts/[id]/`, `api/posts/[id]/votes/`, `api/posts/[id]/comments/`, `api/posts/[id]/reports/`, `api/comments/[id]/`, `api/comments/[id]/reports/`
- Admin queue: `apps/web/src/routes/(app)/admin/reports/`
- UI: `apps/web/src/lib/components/features/problem/left-panel/PostPanel.svelte`, `apps/web/src/lib/components/features/posts/`
- Tests: `tests/unit/application/post-queries.test.ts`, `post-context-gate.test.ts`, `post-resolve-context.test.ts`, `post-mutations.test.ts`, `post-votes.test.ts`, `post-comments.test.ts`, `content-reports.test.ts`; `tests/integration/application/content-reports.test.ts`; `tests/unit/security/exam-confinement-api-allowlist.test.ts`; `tests/unit/web/exam-lock.test.ts`; `tests/integration/web/markdown-renderer-xss.test.ts`; `tests/e2e/editorials.test.ts`

Out of scope: comment nesting beyond one reply level, comment editing, report categories, notifying reporters, signed-out reading, official teacher editorials, revision history, post search or analytics.

## API

| Endpoint                                                                              | Purpose                                                                                       |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /api/problems/[id]/posts?type=editorial\|discussion&page&pageSize&sort=new\|top` | Paged list `{ items, total, page, pageSize }`; `top` sorts by vote score in the app layer     |
| `POST /api/problems/[id]/posts`                                                       | Create (`type`, `title` 1–200 trimmed, `content` 10–50,000)                                   |
| `GET / PATCH / DELETE /api/posts/[id]`                                                | Read; edit (author or admin); soft-delete (author or admin)                                   |
| `POST /api/posts/[id]/votes`                                                          | Vote `+1`, `-1` or `0` (clear)                                                                |
| `GET / POST /api/posts/[id]/comments`                                                 | List (deleted rows as `deleted: true`, empty content); add comment or reply (1–5,000 trimmed) |
| `DELETE /api/comments/[id]`                                                           | Soft-delete comment (author or admin)                                                         |
| `POST /api/posts/[id]/reports`, `POST /api/comments/[id]/reports`                     | Report (`reason` 1–1,000, trimmed non-empty); 201                                             |

All endpoints require a session (`requireApiAuth`, 401 otherwise). Invalid payloads are Zod `ValidationError`s; a PATCH with neither `title` nor `content` is rejected.

## Acceptance criteria

### Gates

- Context gate: `resolveActiveContextForUser` finds live contests, assignments and exams containing the problem for this user and picks the one ending last. Until it ends, every post, comment, vote and report call fails 403 `"Posts are unavailable until the active contest, assignment, or exam ends."`, for both types. The client cannot supply the context; practice URLs do not bypass it.
- Editorial gate (after the context gate): the user has an accepted non-sample submission on the problem, or authored a non-deleted editorial there. Otherwise 403 `"Solve this problem first to view editorials."` (read) or `"Solve this problem first to post an editorial."` (create). Authorship never opens a live context.
- Discussion gate: any signed-in user once the context gate is open.
- Voting, commenting and reporting rerun the same per-type gate for the post's problem.
- Admins bypass the view and context gates for moderation.
- Unknown problem: `NotFoundError("Problem not found.")`.
- An editorial reader whose only AC is rejudged away loses access on the next fetch; an author keeps it.
- In an active exam session with page lock enabled, the hook blocks `/api/posts/*`, `/api/comments/*` and `/api/problems/[id]/posts` for every problem ([Proctoring](proctoring.md#page-lock)).

### Posts

- A user may write any number of posts per problem.
- PATCH updates title/content and `updatedAt`; a PATCH with unchanged values returns the existing row.
- Non-author, non-admin PATCH or DELETE is `ForbiddenError`.
- DELETE stamps `deletedAt`; the post disappears from all list and detail reads; a second DELETE is `NotFoundError`.
- Deleting the problem or the author cascades to posts, votes, comments and reports.

### Votes

- `PostVote` is unique per `(postId, userId)`: `+1`, then `-1`, then `0` creates, flips and clears one row. The response carries the new score and `viewerVote`.
- Voting on your own post: `ForbiddenError("You cannot vote on your own post.")`.

### Comments

- A comment without `parentId` is top-level (201); a reply's `parentId` must be a top-level comment on the same post.
- Replying to a reply: `ValidationError("Replies cannot be nested deeper than one level.")`. Unknown parent or parent on another post: `ValidationError("Parent comment not found.")`. Commenting on a deleted post: `NotFoundError`.
- Author or admin can soft-delete a comment; lists keep the row as a tombstone ("This comment has been deleted.") so replies stay.

### Reports and moderation

- `ContentReport` targets exactly one of a post or a comment; one report per reporter and target (`"You have already reported this content."`, `ConflictError`). Reporting your own content is `ForbiddenError`; a missing or deleted target is `NotFoundError`. New reports are `open` with the trimmed reason.
- `listContentReports` and `resolveContentReport` require admin (`"Admin access required."`). The queue at `/admin/reports` lists open reports newest first with target type (editorial, discussion, comment), preview, reporter and reason.
- `resolve` soft-deletes the target, notifies its author (`post_removed` / `comment_removed`, linking to the problem; no duplicate if already deleted) and sets `resolved` with `resolvedByUserId` and `resolvedAt`. `dismiss` leaves the target and sets `dismissed`. Both write an admin audit row (`content_report_resolve` / `content_report_dismiss`).
- Acting on a handled report: `ConflictError("This report has already been handled.")`.

### Rendering

- Content renders through `MarkdownRenderer` (`apps/web/src/lib/utils/markdown.ts`: marked, KaTeX, DOMPurify). Script tags and `javascript:` links are stripped; KaTeX output survives sanitization; third-party HTTPS images load only through `/api/images/proxy` with no fallback to the remote URL (SEC-10, SEC-11).
- Content at maximum length renders in full.

### Panel UI

- The practice workspace left panel tabs are Description, Submissions, Discussions, Editorials. Contest, exam and assignment workspaces do not render the post tabs (`postsEnabled` false); the API gate is the real barrier.
- Without AC, the Editorials tab shows a "solve this first" lock and fetches nothing; Discussions loads normally.
- List rows show title, author, vote score, comment count and time, with Latest / Top voted sorting and paging. A row opens the article view (content, votes, report dialog, comments, back to list); compose is a title and Markdown form in the same panel.
- Discussion list and form show the hint "Please do not spoil the answer or post complete solutions in discussions."
- Deleted posts vanish from lists; deleted comments show the tombstone.
