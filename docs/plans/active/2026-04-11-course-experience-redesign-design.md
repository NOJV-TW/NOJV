# 課程體驗重新設計 (Course Experience Redesign)

**Date:** 2026-04-11
**Status:** Draft — pending user review
**Scope:** Entire teacher + student course experience: `/courses`, course interior, assignments, exams, members, settings.

## 1. Motivation

測試目前教師流程時發現數個阻擋性 bug 與 UX 缺陷：

- **`problemIds` schema 與 DB 不一致**：`courseAssessmentCreateSchema` 與 `contestCreateSchema` 把 `problemIds` 定義為 `z.array(slugSchema)`，但 `Problem.id` 是 `problem_*` 格式（含底線），任何輸入都無法通過 regex。教師**無法**從 UI 建立作業或考試。
- **Silent failure**：`Assessments.svelte` / `Contests.svelte` 沒有渲染伺服器回傳的錯誤，教師送出失敗時畫面完全無反應。
- **Contest 表單 checkbox 缺 `name`**：allowedLanguages 勾選永遠送出空陣列。
- **登入入口誤導**：一般 `/signin` 只有 OAuth，帳密登入藏在「Admin login」裡。
- **教師/學生介面分裂**：`/courses/[slug]` 與 `/courses/[slug]/manage/*` 走完全不同路徑，導致重複元件、不一致導覽、維護成本高。
- **i18n 混亂**：課程頁同卡片混用中英文，每張卡又各自放一個中/英切換按鈕，與整站語言切換衝突。
- **不必要的複雜度**：`CourseJoinToken`、加入連結、QR 碼、跨課程教師儀表板等使用者不要的功能。

這份 spec 以「老師介面 ≈ 學生介面 + 少量管理控制」為核心重新設計整個課程體驗，順便修掉上列 bug。

## 2. Design Principles

1. **單一介面、差異以控制呈現**。沒有 `/manage/*` 獨立路徑；教師看到的是學生版再疊上按鈕和 Settings Tab。
2. **權限駐點就在原位**。建立 / 編輯 / 刪除 按鈕出現在它管的物件旁邊，不分流到「管理頁」。
3. **沒有 slug**。所有資源 URL 用 Prisma cuid。表單不再要求使用者取網址，消除格式錯誤與衝突 bug。
4. **沒有 silent failure**。伺服器錯誤一定有頁頂橫條或欄位標紅。
5. **延伸現況的視覺語言**（warm editorial：奶油底、Fraunces 襯線、圓角大卡），但移除所有「系統文字」切換按鈕。全站語言由 header 的 en/zh-TW 切換統一控管。
6. **教師權限鏈**：`platformRole=teacher`（可建新課）→ `courseRole=teacher`（課程擁有者）→ `courseRole=ta`（助教，有管理權但不能建新課）→ `courseRole=student`。

## 3. Route Structure

### 3.1 Old routes (to be removed or folded)

```
/courses/[slug]                                    → stays, but use id
/courses/[slug]/manage                             → REMOVED (fold into overview)
/courses/[slug]/manage/members                     → REMOVED (fold into /members)
/courses/[slug]/manage/assessments                 → REMOVED (fold into /assignments + /exams)
/courses/[slug]/manage/progress                    → REMOVED (not needed — see §4.2 Progress)
/courses/[slug]/manage/plagiarism/[assessmentSlug] → REMOVED (fold into assignment detail sub-tab)
/courses/[slug]/join/[token]                       → REMOVED (join tokens deleted, see §5.2)
/courses/[slug]/assignments/[assessmentSlug]       → stays, use id
```

### 3.2 New routes (authoritative list)

```
/courses                                            — two-tab listing (enrolled / managing)
/courses/new                                        — create course form (teacher/admin only)
/courses/[courseId]                                 — Overview tab (default)
/courses/[courseId]/assignments                     — Assignments tab
/courses/[courseId]/assignments/new                 — Create assignment (teacher/TA)
/courses/[courseId]/assignments/[assignmentId]      — Assignment detail (+ sub-tabs for teacher/TA)
/courses/[courseId]/exams                           — Exams tab
/courses/[courseId]/exams/new                       — Create exam (teacher/TA)
/courses/[courseId]/exams/[examId]                  — Exam detail / take-exam page
/courses/[courseId]/members                         — Members tab
/courses/[courseId]/settings                        — Settings tab (teacher/TA only)
```

All `[*Id]` segments are Prisma cuid strings (e.g. `cmbxxxxxxxxxxxxxx`). No slugs anywhere.

## 4. Tab-by-tab design

### 4.1 `/courses` — Courses listing

**Structure:** Hero title "Courses" → two tabs (`自己的課程` / `管理的課程`) → Active/Archived filter chips → course cards grid.

- **`自己的課程`**: courses where current user has `courseRole = student`. Students land here by default. TA does NOT show here.
- **`管理的課程`**: courses where current user has `courseRole ∈ {teacher, ta}`.
- Both tabs always visible; empty state shown when 0 items.
- **`+ Create course`** button top-right, visible **only** when `platformRole ∈ {teacher, admin}`. Always on the managing tab; hidden on enrolled tab.
- Each course card: `{semester label}` / role badge / course title / subtitle (`Prof. X · N students` for students, `N students` for teachers/TAs) / status chips:
  - Student variant: `{n} assignments due`, `{n} exam upcoming`, or `All caught up`
  - Teacher/TA variant: `{n} open`, `{n} draft`, `{n} exam`
- Click card → `/courses/[courseId]` (Overview tab).

**Removed:** the current "教師儀表板 / 跨課程教學健康度" panel is gone.

### 4.2 `/courses/[courseId]` — Overview

**Tab navigation (sticky):** `Overview | Assignments | Exams | Members | Settings*`
(* Settings only visible to `courseRole ∈ {teacher, ta}`.)

**Header:** course title + subtitle (`semester · N students`), right-aligned `TEACHER` badge when user has management role.

**Blocks (same order, same structure for all roles):**

1. **📌 Announcements** — list of announcements, each with author + relative timestamp.
   - Teacher/TA only: ✎ edit button on each announcement + `+ 新公告` button in section header.
2. **📝 Assignments** — upcoming / open assignments (max ~5, sorted by due date). Each row: title, due date, problem count, status chip.
   - Student extra info: their own status chip (`In progress`, `Not started`, `Submitted`)
   - Teacher/TA extra info: class stats (`14/23 submitted · avg 78`) — **only** visible to teacher/TA roles.
   - Teacher/TA only: `+ 新作業` button in section header → `/assignments/new`.
3. **🏁 Exams** — same shape as Assignments, upcoming exams.
   - Teacher/TA only: `+ 新考試` button → `/exams/new`.

**No progress card, no heatmap, no todo-count cards, no batch stats at top.**

### 4.3 `/courses/[courseId]/assignments` — Assignments list

**Structure:** Header with title → filter chips → list of assignment cards.

- **Filter chips (all roles):** `All`, `Open`, `Upcoming`, `Closed`
- **Teacher/TA extra filter:** `Draft`
- **`+ 新作業`** button top-right: only teacher/TA.
- **Row structure:** title, status badge, due date, problem count.
  - Student: personal status (`In progress 60`, `Not started`, `Final score: 92/100`), primary action button (`Start / Continue / View results`).
  - Teacher/TA: class stats (`12/23 submitted · avg 78`), primary action → navigate to detail page. Draft rows styled with dashed left border + Publish hint.
- **No ⋮ menu on rows.** All management actions (edit/duplicate/delete/plagiarism/export) live inside the detail page.

### 4.4 `/courses/[courseId]/assignments/[assignmentId]` — Assignment detail

**Shared header for all roles:**
- Breadcrumb: `← Assignments`
- Title + meta (`Due Apr 18, 23:59 · 3 problems · Max 5 attempts` for student; replace `Max 5 attempts` with `12/23 submitted` for teacher/TA).
- Status badge (`Open / Closed / Upcoming / Draft`).
- **No description block**. If a summary is needed it lives inside Problems section or nowhere.

**Body:**
- **Student:** single `Problems` list (no sub-tabs). Each row shows problem title, difficulty, points, personal result (`✓ Solved 100`, `In progress 60`, `Not started`). Footer: `Your score so far: X / Y` (right-aligned).
- **Teacher/TA:** sub-tab strip `Problems | 提交 [N] | 抄襲 | 設定`. Each tab swaps the body only; header stays.
  - `Problems` tab body: same problem list, each row augmented with class stats (`20/23 solved · avg 94`).
  - `提交` tab body: filterable table of student submissions — columns: handle, student name, last submission time, best score, attempts, action (`View submission →`). Filters: role-gate to student-only, problem picker, status (`pending / accepted / rejected`). Row click navigates to submission detail (existing `/submissions` page or inline drawer).
  - `抄襲` tab body: plagiarism report summary. Shows last-run timestamp, overall similarity distribution, and top-N flagged pairs. Button to trigger a new run (idempotent, disabled while running). Detailed pair diff view in a right drawer or inline expansion (to be refined in impl; this spec commits to housing it under this sub-tab).
  - `設定` tab body: same component as the create-assignment form pre-filled with current values. Includes Danger zone (Duplicate, Unpublish, Delete).

### 4.5 `/courses/[courseId]/assignments/new` — Create assignment (teacher/TA)

Also used by `設定` sub-tab as the edit view.

**Form sections (stacked cards):**

1. **Basics**
   - `Title` *
   - (**No slug, no summary field.**)
2. **Problems** *
   - **Problem picker** component:
     - Search box (title + tag matching on existing accessible problems)
     - Dropdown list of matches, each row `+ Add` adds to selection
     - Selected list with drag handle (`≡`) for reordering, `✕` to remove
     - **Sends `problemIds: Problem.id[]` to server**. No free-text input.
3. **Schedule**
   - `Opens` * / `Due` * / `Hard close` * (three datetime-local)
4. **Advanced** (collapsed by default)
   - Allowed languages (multi-checkbox)
   - Max attempts (nullable)
   - Adjustment rules (late penalty editor)

**Buttons:** `Save draft` (outline) and `Publish` (solid). Editing flow: `Save`.

**Error handling:** on fail, a red banner appears above the form with server message; offending fields get red outline + inline text error. **No more silent failures.**

### 4.6 `/courses/[courseId]/exams` — Exams list

Same shape as Assignments list, but:
- Rows show `Starts May 3, 14:00 · 180 min` instead of due date.
- Status chips: `Upcoming / Running / Ended / Draft`.
- Primary action for student: `Start exam` (only when status == Running and student hasn't submitted).
- Teacher/TA extra column: `N registered · N submitted`.

### 4.7 `/courses/[courseId]/exams/[examId]` — Exam detail / take-exam

**Two distinct states:**

**State A: Outside active session (registration view)**
- Shared: breadcrumb, title, schedule, scoring mode, proctoring summary, registered-count.
- Student: `Start exam` button (disabled until start time).
- Teacher/TA: sub-tabs `Problems | 提交 | 設定` (no `抄襲` — not applicable to exams), `+ Announce / Unlock` panel.

**State B: Inside active session (exam mode — student only)**
- Triggered when student clicks `Start exam` and server creates an `ActiveExamSession` row.
- **Full-screen layout**: main nav hidden; only exam problems, timer, submission area, and a single `Submit & end` button.
- **Route confinement (session lock):**
  - New SvelteKit hook `apps/web/src/hooks.server.ts` checks for `ActiveExamSession` on every request.
  - If active session exists and request path is NOT one of the exam's own paths, issue `redirect(307, /courses/[courseId]/exams/[examId])`.
  - Client-side: `popstate` and `beforeunload` handlers also redirect back.
- **Exit conditions (the ONLY ways out):**
  1. Exam end time reached → session auto-closed by worker
  2. Student clicks `Submit & end`
  3. Teacher/TA clicks `Release` on the student's row in the Submissions sub-tab (manual unlock)
- **Audit logging**: new `ExamSessionEvent` rows for `enter`, `visibility_lost`, `release`, `auto_close`.
- **Settings `分頁鎖` semantics** (clarification): this flag *enables the session lock*; when off, students can freely navigate the rest of the site during the exam window. The lock is not a warning system; it is hard confinement within the SvelteKit app. (Cannot prevent the student from opening a new browser tab; that remains a human invigilation problem.)

### 4.8 `/courses/[courseId]/exams/new` — Create exam

Same scaffold as assignment form plus two extra cards:

5. **Proctoring**
   - `分頁鎖` toggle — when on, activates §4.7 State B session confinement
   - `IP 綁定（首次登入）` toggle — pins the student IP seen at first sign-in to the session
   - `IP 白名單` toggle + CIDR textarea (one per line)
6. **Scoring**
   - Scoring mode dropdown (`ICPC problem_count` / `IOI point_sum`)
   - Scoreboard mode dropdown (`live / frozen / hidden`)
   - Submit cooldown (seconds)
   - Optional freeze-at datetime in Schedule card

### 4.9 `/courses/[courseId]/members` — Members tab

**Structure:** header → (teacher/TA only) Add members panel → filter chips → roster list.

- **Filter chips**: `All / Teachers / TAs / Students` (students see same chips).
- **Search**: filters roster by name / handle (visible to all).
- **Roster row**: avatar + name + handle (monospace) + joined date.
  - Students see: avatar + name + handle + role badge. **No email.**
  - Teacher/TA extra: email, role dropdown (change role), `Remove` button.

**Add members panel (teacher/TA only):**
- Expands on `+ Add members` click
- Textarea accepts pasted handles, one per line or separated by `,` / whitespace
- Role selector (defaults to Student, also TA)
- `Confirm add` button
- Server:
  - Parse + deduplicate handles
  - For each handle:
    - Existing active user → insert `CourseMember` row
    - Existing course member → skip
    - Not found → create a **placeholder User** (see §5.3) and insert `CourseMember` row
  - Return a single summary toast: `Added N members (K new placeholders created, L skipped as already in course)`.
- **No preview step.** Parse and show results after submit, not before.
- **No join codes, no join links, no QR, no join requests.**

### 4.10 `/courses/[courseId]/settings` — Settings (teacher/TA only)

**Stacked cards:**

1. **Course info**
   - Title, Description, Default locale, Term / Semester (the existing `metadata` JSON covers this)
2. **Default policies**
   - Default allowed languages (pill multi-select)
   - Default late-penalty rule (used as a template when creating new assignments/exams)
3. **Visibility**
   - Archived toggle
4. **Danger zone**
   - `Delete course` button with confirmation modal requiring typed course title

## 5. Data & schema changes

### 5.1 Remove slugs

Migrations required:

| Model              | Action                                                |
|--------------------|-------------------------------------------------------|
| `Course`           | Drop column `slug`; no replacement (id used in URLs)  |
| `CourseAssessment` | Drop column `slug`                                    |
| `Contest`          | Drop column `slug`                                    |
| `Problem`          | Change `id` default from seeded `problem_*` strings to Prisma `cuid()`. Seeded data rebuilt with cuid-like ids |

Knock-on:
- `packages/core/src/schemas/course.ts`: `courseCreateSchema.slug` and `courseAssessmentCreateSchema.slug` / `.problemIds` field deleted. `problemIds` now `z.array(z.string().min(1)).min(1).max(32)` (plain string id validation, not slug).
- `packages/core/src/schemas/contest.ts`: same for contest schema.
- `packages/db/prisma/seeds/*`: rewrite with ids + drop slug fields.
- Tests referencing slugs by string (`"os-lab-spring-2026"`, `"hw1-sorting"`) updated.
- All route params renamed: `[slug]` → `[courseId]`, `[assessmentSlug]` → `[assignmentId]`.

### 5.2 Remove join tokens

- Drop `CourseJoinToken` model entirely.
- Delete `/courses/[slug]/join/[token]` route and related server logic.
- Delete seeded join token data in `packages/db/prisma/seeds/courses.ts`.

### 5.3 Placeholder users

For handles pasted by teachers that don't match an existing user:
- Create `User` with `handle = pasted handle`, `status = 'pending_first_login'` (new enum value), `email = null`, `authProviderIds = []`.
- First time a real user authenticates via OAuth or admin-signin with a matching handle, the auth adapter finds the placeholder by handle and attaches the auth identity to it (rather than creating a new user). This logic lives in a better-auth `onBeforeCreateUser` hook in `apps/web/src/lib/server/auth`.
- Add `User.handle` as a nullable unique text column in the same migration as the placeholder support (the column does not exist today).

### 5.4 New models / fields

- `ExamSessionEvent` — append-only audit log for exam sessions (`sessionId`, `eventType enum`, `occurredAt`, `metadata Json`)
- `ActiveExamSession` — new model. One row per student per exam while they are inside the locked session. Fields: `id`, `userId`, `examId`, `startedAt`, `endedAt` (nullable), `releaseReason enum('submitted','time_up','released')`, `ipPin` (nullable), `lastHeartbeatAt`.
- `CourseAssessment.description` / `.summary`: **removed** (drop column).
- `CourseAssessment.status`: add `'draft'` value so we can save drafts before publishing. Also on `Contest.status`.

## 6. Permissions

| Action                                | platformRole | courseRole            |
|---------------------------------------|--------------|-----------------------|
| Create course                         | teacher, admin | n/a                 |
| Edit course settings                  | any          | teacher, ta            |
| Create / edit / delete assignment     | any          | teacher, ta            |
| Create / edit / delete exam           | any          | teacher, ta            |
| Post / edit announcements             | any          | teacher, ta            |
| Add / remove members                  | any          | teacher, ta            |
| Change member role                    | any          | teacher                |
| Release student from exam session     | any          | teacher, ta            |
| See class stats on assignments/exams  | any          | teacher, ta            |
| See other members' emails             | any          | teacher, ta            |

TA ≈ teacher in almost all course-level actions **except** changing member roles (only teacher) and creating new courses (blocked by platformRole gate).

## 7. Visual language

- Keep current warm-editorial palette (cream `#f6efe6`, panels `#fff8ee`, borders `#e4d6bf`, accent orange `#c96c2a`).
- Fraunces for display headings; Manrope for body; JetBrains Mono for handles/code.
- Rounded-2xl cards, generous padding, section labels in small uppercase letter-spaced.
- **Remove every per-card `中文 / English` toggle**. Single source of truth: the header-level locale switcher driving i18n via existing messages files.
- Teacher-mode visual cue: small pill `TEACHER` top-right of course header, and `Settings` tab in the nav bar. Nothing else (no colored borders, no banners).

## 8. Error handling

New shared `FormError` component rendered at top of any form:
- Red left border + icon + server message
- Auto-scroll-to on submit failure
- Per-field errors still render inline (unchanged)

The superForm setup in `Assessments.svelte`, `Contests.svelte`, and the new assignment/exam forms must surface `$message` AND the top-level `error` key from the action result. Audit every `fail(400, { form, error: ... })` site and make sure error is displayed.

## 9. Out of scope

- Grading UI beyond what the auto-judger reports (no manual rubrics in this redesign)
- Appeals / disputes workflow (mentioned as a potential future feature)
- Cross-course analytics / teacher health dashboard (intentionally removed)
- Student personal progress dashboard (no separate Progress tab)
- Invite links / QR / public join (intentionally removed)
- Per-course language override — site language is the only switch
- Mobile-first responsive work (design is desktop-first; small-screen acceptable but not prioritized)

## 10. Migration plan (high level)

1. **Phase 0 — Prep:** land the `FormError` component and fix silent failures on existing `Assessments` / `Contests` forms in-place (unblocks current teachers before route migration).
2. **Phase 1 — Schema:** write Prisma migrations to drop slugs, drop `CourseJoinToken`, drop `CourseAssessment.summary`, add `handle` placeholder, add `ExamSessionEvent`, add `draft` status value. Update seeds and tests.
3. **Phase 2 — New routes:** scaffold `/courses/[courseId]` route tree with redirects from the old `[slug]` paths. Old `/manage/*` paths return 308 to new locations.
4. **Phase 3 — Unified UI:** port each tab into the new components (Overview, Assignments, AssignmentDetail, AssignmentForm, Exams, ExamDetail, ExamForm, Members, Settings). Teacher-gated affordances live inside each shared component.
5. **Phase 4 — Exam session lock:** implement `hooks.server.ts` route confinement, client-side confinement, release endpoint, audit log.
6. **Phase 5 — Members rework:** delete `CourseJoinToken`, implement bulk-handle add + placeholder creation hook.
7. **Phase 6 — Cleanup:** remove old `/manage/*` routes, per-card language toggles, unused i18n strings, cross-course dashboard load on `/courses`.

Each phase commits independently so the tree stays green.

## 11. Open questions (for user review)

None currently — all design decisions captured from brainstorming session. If any ambiguity surfaces during implementation, loop back to this document.
