# Product and UI decisions

Durable decisions for product scope, problem posts and web UI conventions. Read the relevant entries before planning a change here; a change that contradicts an entry must say so and update or replace the entry in the same PR. Current mechanics live in [Product Sense](../product/PRODUCT_SENSE.md), [Design Rules](../architecture/DESIGN.md) and [Frontend Surface](../architecture/FRONTEND.md).

### UI-01 DOMjudge semantics without ICPC contest control

**Decided:** 2026-06 · **Source:** [2026-06-13-domjudge-alignment-followup](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-13-domjudge-alignment-followup.md)

NOJV adopts DOMjudge judging semantics but not its ICPC contest-control features. It is a single-institution course/exam platform, and a stateless Temporal worker with retries already covers judgehost health management.

- Rejected: teams, categories, affiliations, balloons, awards, CLICS API/event feed, shadow judging, resolver, public registration, judgehost quarantine, multi-pass, configurable results_prio, Kattis/ICPC package import.
- Rule: output overflow (16 MiB) is RE; there is no OLE verdict. OLE and lossless bundle export (TestcaseSet boundaries and weights) are later candidates; lazy_eval and scorecache wait for measurements showing they are needed.
- Code: `docs/architecture/JUDGE_PIPELINE.md`

### UI-02 Public problem publishing stays owner-driven

**Decided:** 2026-09 · **Source:** [2026-09-08-problem-permissions](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-08-problem-permissions.md)

Existing owner publish eligibility and public-problem ownership are unchanged; whether public publishing and maintenance should become admin-only is explicitly undecided. It was out of scope for the co-edit migration.

- Rule: adopting admin-only publishing needs its own plan covering owner permission takeover and notification/handover.

### UI-03 Email is an opt-out channel on top of in-site notifications

**Decided:** 2026-07 · **Source:** [2026-07-10-email-notifications-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-10-email-notifications-design.md), [2026-07-10-email-notifications-plan](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-10-email-notifications-plan.md)

Every notification event is always created in-site; email is gated by per-user booleans, all on by default. `NotificationPreference` is one lazily created row per user (no row means defaults) with explicit columns, including lead days 1–7 (assignment 3, exam 1, contest 1) that time both channels. Explicit columns make fanout reverse queries ("users whose lead days == N") straightforward.

- Rejected: a JSON preference blob; email on `clarification_answered`; a notification at the exact deadline; an editorial review-result email (there is no review flow, so it became a removal email).
- Rule: email follows the in-site dedupe result; a deduped notification sends no email.
- Rule: email only verified, non-placeholder addresses, and link to `/account` for preferences.
- Code: `packages/db/prisma/schema/notification.prisma`, `packages/core/src/notification-preferences.ts`, `packages/application/src/notification/email.ts`

### UI-04 Editorials and discussions are one problem-post model with moderated reports

**Decided:** 2026-07 · **Source:** [2026-07-10-problem-posts-discussions](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-10-problem-posts-discussions.md), [2026-07-10-problem-posts-discussions-plan](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-10-problem-posts-discussions-plan.md), [2026-05-18-feature-completion-batch](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-18-feature-completion-batch.md), [2026-04-30-functional-gaps](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-30-functional-gaps.md)

`ProblemPost` has type `editorial` or `discussion`, and a user may write many posts per problem. Comments have two levels (a reply targets a top-level comment). Deletes are soft (`deletedAt`): a deleted comment renders as a tombstone, a deleted post disappears. `ContentReport` targets exactly one of post or comment; the admin queue at `/admin/reports` resolves (soft-delete and notify the author) or dismisses, both audited. This converged the separate editorial and discussion features onto one domain and API.

- Rejected: nested multi-level comments, comment editing, report categories, reporter notifications, anonymous browsing of discussions. Earlier: separate `Editorial`/`EditorialReport` models with per-language uniqueness (2026-04/05), replaced by this model; voting and comments, deferred in 2026-04, were added here.
- Rule: reads exclude soft-deleted rows; only the author or an admin edits or deletes.
- Rule: one report per user per target, never on one's own content, reason 1–1000 characters; the exactly-one-target CHECK is hand-written migration SQL.
- Code: `packages/db/prisma/schema/submission.prisma`, `packages/application/src/post/`, `apps/web/src/routes/(app)/admin/reports`

### UI-05 Problem posts are gated server-side by active context and AC

**Decided:** 2026-07 · **Source:** [2026-05-27-submission-unification-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-27-submission-unification-design.md), [2026-07-10-problem-posts-discussions](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-10-problem-posts-discussions.md), [2026-09-05-architecture-simplification](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-09-05-architecture-simplification.md)

Every post, comment, vote and report path resolves the user's strictest active context server-side (`resolveActiveContextForUser`); while a contest, assignment or exam containing the problem is running, it returns 403, and access reopens after `endsAt`/`closesAt`. Editorials additionally require AC on the problem or having authored a post on it (so a rejudge does not lock an author out); discussions require login only. A frontend context or entry URL cannot be trusted, so the practice path must not bypass an exam.

- Rejected: relying on the UI hiding tabs; that is only a second layer.
- Rule: every post read path passes a `PostViewContext`, and the activity restriction holds even after AC.
- Rule: exam confinement never allows the posts or comments API paths; post tabs render only in practice mode.
- Code: `packages/application/src/post/queries.ts`, `packages/application/src/post/mutations.ts`, `tests/unit/security/exam-confinement-api-allowlist.test.ts`

### UI-06 Posts live in the problem workspace panel

**Decided:** 2026-07 · **Source:** [2026-07-10-problem-posts-discussions-plan](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-10-problem-posts-discussions-plan.md), [2026-07-10-problem-posts-discussions](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-10-problem-posts-discussions.md)

Editorials and discussions live entirely in the problem workspace's left panel, LeetCode-style: list, article with comments, and compose/edit all switch inside the panel (user ruling, 2026-07-11).

- Rejected: standalone `/problems/[id]/{editorials|discussions}/[postId]` pages and the old editorial edit pages, which were removed.
- Code: `apps/web/src/lib/components/features/posts/`

### UI-07 All UI text ships in en and zh-TW through Paraglide

**Decided:** 2026-04 · **Source:** [2026-04-03-problem-config-implementation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-03-problem-config-implementation.md), [2026-04-11-admin-users-ux-refinement-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-11-admin-users-ux-refinement-design.md)

Every new UI string is a Paraglide message (`m.*`) with both `en` and `zh-TW` values. The app is bilingual, and page-local dictionaries are legacy.

- Rejected: adding strings to page-local zh/en dictionaries.
- Rule: add each key to both `apps/web/messages/en.json` and `apps/web/messages/zh-TW.json`.
- Rule: Paraglide runs on the client, so server loaders return stable ids and translated text lives in `.svelte` files.
- Code: `apps/web/messages/`

### UI-08 One site-level locale switcher; locale-bound date formatting

**Decided:** 2026-04 · **Source:** [2026-04-11-course-experience-redesign-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-11-course-experience-redesign-design.md), [2026-05-20-grading-feedback-audit-batch-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-20-grading-feedback-audit-batch-design.md)

The header en/zh-TW switcher is the only language control, and all date/time display goes through `formatDateTime`, bound to the Paraglide locale with a timezone abbreviation. Per-card toggles mixed languages on one card, and a timezone setting is YAGNI.

- Rejected: per-card language toggles and a per-course locale override (`Course.locale` dropped); a per-user timezone preference.
- Rule: do not add component-level language toggles or ad-hoc date formatting.
- Rule: skeletons only for deferred loads; list pages rely on SSR.
- Code: `apps/web/src/lib/utils/datetime.ts`

### UI-09 Pages use three layout archetypes: Index, Hub, Workspace

**Decided:** 2026-04 · **Source:** [2026-04-30-page-layout-system](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-30-page-layout-system.md)

Pages differ by header zone and share one body container: Index (lists) uses `<PageHeader>` with a required eyebrow, Hub (for example course detail) uses `<PageHero variant="hub">`, Workspace uses `<PageHero variant="workspace">`. Tokens were consistent but each page built its own chrome, so layout felt random.

- Rejected: new tokens or colours; sidebars on Workspace pages.
- Rule: horizontal padding is set once on the `(app)` layout `<main>`; pages add no `px-*` wrappers.
- Rule: two columns only when the sidebar has at least three meaningful parallel items and fills at least 30% of the row at `lg+` (today only course detail).
- Rule: spacing `space-y-6` within a section, `space-y-10` between sections, `space-y-16` for major breaks.
- Code: `apps/web/src/lib/components/primitives/layout/`

### UI-10 Top-level list pages share a header and `?tab=` tab row

**Decided:** 2026-04 · **Source:** [2026-04-16-list-page-unification-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-16-list-page-unification-design.md)

`/courses`, `/assignments`, `/exams` and `/contests` share eyebrow, display h1 and subtitle, then an underline tab row with count badges and actions on the right; status filters are tabs addressed by `?tab=`. Five pages had five visual frameworks. `/problems` is excluded and `/contests` keeps free-text search.

- Rejected: FilterChips on these pages; keeping old `?status=` links working.
- Rule: list filters use `?tab=`; archived courses are dimmed inline and count toward tab totals.
- Code: `apps/web/src/routes/(app)/assignments/+page.server.ts`

### UI-11 Share a component only when content converges, not shape

**Decided:** 2026-04 · **Source:** [2026-04-12-codebase-cleanup-audit](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-12-codebase-cleanup-audit.md), [2026-04-16-list-page-unification-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-16-list-page-unification-design.md)

Do not extract a shared component because surfaces look alike; list-page header and tab markup is duplicated per page so each can diverge. Forcing different pages through one component produces an abstraction that serves neither call site. Shared assessment surfaces (`AssessmentRow`, `AssessmentHero`, `AssessmentManageTabs`) exist because their content converged.

- Rejected: `DataTableWithFilters` (matched pages by line count) and `ListPageShell`; changing `Section.svelte` globally for one page.
- Code: `docs/architecture/DESIGN.md`

### UI-12 Table filters and row editors use Bits UI, not native selects

**Decided:** 2026-09 · **Source:** [2026-09-07-member-table-filters](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-09-07-member-table-filters.md)

`TableSelectColumnFilter` (submissions, live course submissions, admin reports, course members) and table row editors use Bits UI menus/Select instead of native overlays; filters stay reachable when no rows match, and tables scroll natively on mobile. This keeps visuals consistent and filtering accessible.

- Rule: privileged-role changes keep confirmation and reset the row selection on cancel or rejection; the confirmation cancel uses Bits UI `Dialog.Close` so caller cleanup runs.
- Code: `apps/web/src/routes/(app)/courses/[courseId]/members/+page.svelte`

### UI-13 Mobile is read-only; no solving workspace below `md`

**Decided:** 2026-04 · **Source:** [2026-04-30-functional-gaps](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-30-functional-gaps.md)

Phones browse statements, lists, scoreboards, posts and dashboards, but the Monaco editor and submit form are hidden below `md` and replaced by `<MobileWorkspaceBlocker>`. Solving on a phone is an explicit non-goal.

- Rule: the blocker is CSS/visual only and never replaces server-side IP or page-lock gating.
- Rule: every `(app)` page must still render at `sm` width.
- Code: `apps/web/src/lib/components/features/problem/layouts/MobileWorkspaceBlocker.svelte`

### UI-14 Solve pages fill the viewport; motion stays restrained

**Decided:** 2026-06 · **Source:** [2026-06-02-ui-overhaul-animations](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-02-ui-overhaul-animations.md)

Routes ending in `/problems/[problemId]` render immersive: `h-dvh`, no footer, no page scroll. Entrance animations take at most 700ms and hover transitions at most 160ms, and `prefers-reduced-motion` is respected globally. The earlier layout overflowed 100dvh, pushing the footer and clipping borders.

- Rejected: an output diff view (see SEC-12 in security.md). Draft storage is WEB-05 in web.md.
- Rule: no magic-number `calc(100dvh-…)` heights.
- Code: `apps/web/src/routes/(app)/+layout.svelte`, `apps/web/src/app.css`

### UI-15 The problem editor follows the author's mental model

**Decided:** 2026-04 · **Source:** [2026-04-09-problem-ui-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-09-problem-ui-redesign.md), [2026-04-03-problem-config-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-03-problem-config-redesign.md)

Editor sections run basic statement → workspace (limits, env, languages, files) → testcases → judge, with scoring folded into judge, plus advanced and reference-solution sections. This mirrors how setters think; a separate scoring tab was too small.

- Rejected: five tabs with scoring separate; execution split from workspace; a pipeline editor.
- Rule: keep execution limits and env next to the workspace files they affect.
- Code: `apps/web/src/routes/(app)/problems/[problemId]/edit/+page.svelte`

### UI-16 Activity problems are chosen in one explicit multi-select dialog

**Decided:** 2026-08 · **Source:** [2026-08-16-problem-picker-search](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-08-16-problem-picker-search.md), [2026-08-20-problem-selector-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-08-20-problem-selector-redesign.md), [2026-08-18-drag-reorder-problems](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-08-18-drag-reorder-problems.md)

Assignment, exam and contest flows share `ProblemSelectDialog`: search by display ID (`#N` or `N`) and title across separate public and personal groups, checkbox multi-select, explicit confirm. Order is edited by native HTML5 drag-and-drop with a keyboard fallback, reusing existing array payloads. Hidden click-to-add pickers and manual ID inputs were error-prone.

- Rejected: a dialog that persists data itself; manual problem-ID text inputs.
- Rule: the dialog only returns candidates; parents own ordered rows, points, permissions and saves.
- Code: `apps/web/src/lib/components/features/problem/ProblemSelectDialog.svelte`, `apps/web/src/lib/utils/reorder.ts`

### UI-17 Assessment management shares one tab set; hand-in lives on the exam overview

**Decided:** 2026-09 · **Source:** [2026-09-21-exam-access-safety](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-21-exam-access-safety.md)

Assignment, exam and contest management use `AssessmentManageTabs`: Problems / Submissions / Results (Grades, Plagiarism, Audit) / Clarifications / Settings, addressable via `?tab=`, with an exam-only Proctoring tab (credentials, IP records). Exam hand-in moved from the workspace timer to the overview, behind a dialog whose initial focus is cancel, to prevent accidental hand-in.

- Rule: Settings stays last; preserve permissions and existing `?tab=` URLs.
- Rule: hand-in confirmation focuses cancel first.
- Code: `apps/web/src/lib/components/features/coursework/AssessmentManageTabs.svelte`, `apps/web/src/lib/components/features/course/exam/ExamHandInPanel.svelte`

### UI-18 Submission IDs appear only in detail views

**Decided:** 2026-09 · **Source:** [2026-09-08-submission-id](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-09-08-submission-id.md)

Submission IDs, with a copy button, appear as a labeled metadata field only in submission detail views (including expanded workspace history and source comparisons); tables and lists omit them so verdict and score stay primary.

- Code: `apps/web/src/lib/components/features/submission/SubmissionId.svelte`

### UI-19 The personal dashboard is an ability overview, not an aggregator

**Decided:** 2026-04 · **Source:** [2026-04-11-dashboard-ability-redesign-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-11-dashboard-ability-redesign-design.md), [2026-04-11-dashboard-ability-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-11-dashboard-ability-redesign.md)

The personal `/dashboard` view shows only the user's ability data (KPIs, activity heatmap bucketed as in WEB-06 in web.md, top tags by AC, difficulty and verdict charts, recent submissions), derived from existing data with no new tables. It had duplicated dedicated routes and lost its purpose. A separate `?view=server` tab shows the platform overview.

- Rejected: repeating courses, assessments, announcements or recommendations; tag taxonomies and peer percentiles (deferred). Earlier: a 30-day heatmap (2026-04) — extended to a 365-day window.
- Rule: no Fraunces, `uppercase` or `tracking-wide` on CJK-heavy headings or labels; numbers use `tabular-nums`.
- Code: `apps/web/src/routes/(app)/dashboard/+page.svelte`, `packages/application/src/user/queries.ts`

### UI-20 Home shows every visible item in equal-height scroll panels

**Decided:** 2026-09 · **Source:** [2026-09-04-home-scroll-panels](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-04-home-scroll-panels.md)

Home announcement and assessment reads have no homepage-only limits but keep audience, publication, membership and time filters. The two desktop cards share a bounded height with scrollable bodies; mobile scrolls naturally, and signed-in assessments list open before upcoming. Users must see every visible announcement and unfinished assessment.

- Rejected: tabs or new components for this.
- Code: `packages/application/src/home/upcoming-assessments.ts`, `apps/web/src/routes/(public)/+page.server.ts`

### UI-21 About and legal pages are public and reached from the footer

**Decided:** 2026-05 · **Source:** [2026-05-12-about-page-and-footer-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-12-about-page-and-footer-design.md)

`/about`, `/legal/terms` and `/legal/privacy` live in the `(public)` group, readable without sign-in, with the shared Footer linking them. The content is static: developer data is hardcoded in the page and legal pages hold placeholder text.

- Rejected: a CMS or DB-backed developer list; newsletter or social links; a collapsible mobile footer; an About link in the header.
- Code: `apps/web/src/routes/(public)/about`, `apps/web/src/lib/components/primitives/layout/Footer.svelte`

### UI-22 Onboarding tours: one engine, role registries, server-side seen state

**Decided:** 2026-07 · **Source:** [2026-07-11-teacher-onboarding-tour](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-11-teacher-onboarding-tour.md), [2026-07-15-durable-onboarding-tour-state](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-15-durable-onboarding-tour-state.md)

One singleton driver.js engine serves student and teacher registries (teacher keys role-prefixed; course TAs get manager intros appended to the student registry, anchored on manager-only UI; admins get none). `User.studentTourSeenAt`/`teacherTourSeenAt` are the source of truth: the dashboard atomically claims the unseen tour via `/api/account/onboarding-tour` before playing the welcome intro, so it shows once per account across devices. Two engines would fight over the single active tour.

- Rejected: backend course-role checks for TA tours. Earlier: localStorage seen keys and the `nojv:tour:off` e2e switch (2026-07-11), replaced by DB timestamps; seeded and E2E users are marked seen.
- Rule: on claim failure the client fails quietly with no fallback; only stored student/teacher roles can claim; manual replay keeps in-memory session progress only.
- Rule: steps silently skip missing anchors, so verify new anchors manually.
- Code: `apps/web/src/lib/onboarding/engine.ts`, `apps/web/src/routes/api/account/onboarding-tour`, `packages/db/prisma/schema/auth.prisma`
