# Database Schema

PostgreSQL 18 with Prisma 7. Schema split across `packages/db/prisma/schema/*.prisma` (auth, clarification, config, contest, course, notification, ops, problem, submission).

## Domain Model Overview

```
User ──┬── Session
       ├── Account (OAuth: GitHub, Google)
       ├── Submission ──→ Problem
       ├── ContestParticipation ──→ Contest
       ├── CourseMembership ──→ Course
       ├── AssessmentParticipation ──→ CourseAssessment
       ├── UserDailyActivity
       ├── Editorial
       └── IpViolationLog

Problem ──┬── ProblemStatementI18n (locale-specific content)
          ├── TestcaseSet ──→ Testcase (standard mode: graded only)
          ├── ProblemWorkspaceFile (per-language files with visibility + editable regions)
          ├── ContestProblem ──→ Contest
          ├── CourseAssessmentProblem ──→ CourseAssessment
          └── Editorial

Contest ──┬── ContestProblem
          ├── ContestParticipation
          ├── Submission
          └── IpViolationLog

Course ──┬── CourseMembership
         ├── CourseJoinToken
         ├── CourseAssessment ──┬── CourseAssessmentProblem
         │                     ├── AssessmentParticipation
         │                     └── IpViolationLog
         ├── Contest (course-linked)
         └── Submission
```

## Enums

| Enum                      | Values                                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `SupportedLanguage`       | c, cpp, go, java, javascript, python, rust, typescript                                                                       |
| `SubmissionStatus`        | queued, compiling, running, accepted, wrong_answer, time_limit_exceeded, memory_limit_exceeded, runtime_error, compile_error |
| `JudgeType`               | standard, checker, interactive                                                                                               |
| `ProblemType`             | full_source, multi_file, special_env                                                                                         |
| `ProblemDifficulty`       | easy, medium, hard                                                                                                           |
| `ProblemImageSource`      | registry, tarball                                                                                                            |
| `WorkspaceFileVisibility` | editable, readonly, hidden                                                                                                   |
| `PlatformRole`            | admin, teacher, student                                                                                                      |
| `CourseRole`              | teacher, ta, student                                                                                                         |
| `ContestScoringMode`      | problem_count, point_sum                                                                                                     |
| `CourseMembershipStatus`  | active, removed                                                                                                              |
| `CourseJoinTokenKind`     | link, code                                                                                                                   |
| `ProblemVisibility`       | public, private                                                                                                              |
| `ProblemStatus`           | draft, published                                                                                                             |
| `ScoreboardMode`          | hidden, live, frozen                                                                                                         |
| `PlagiarismReportStatus`  | pending, running, completed, failed                                                                                          |

## Key Models

### User

Central identity. Links to sessions, OAuth accounts, submissions, course memberships, contest participations, and stats.

| Field          | Type         | Notes                                     |
| -------------- | ------------ | ----------------------------------------- |
| `email`        | String       | Unique                                    |
| `username`     | String?      | Unique, optional until profile completion |
| `platformRole` | PlatformRole | Default: student                          |
| `disabled`     | Boolean      | Admin can disable accounts                |
| `locale`       | String       | Default: zh-TW                            |

### Problem

| Field                 | Type                | Notes                                                               |
| --------------------- | ------------------- | ------------------------------------------------------------------- |
| `id`                  | String              | CUID, primary key                                                   |
| `title`               | String              | Problem title                                                       |
| `visibility`          | ProblemVisibility   | public or private (course-only)                                     |
| `status`              | ProblemStatus       | draft or published                                                  |
| `type`                | ProblemType         | full_source, multi_file, or special_env                             |
| `difficulty`          | ProblemDifficulty   | easy, medium, or hard (dedicated column; NOT a tag)                 |
| `tags`                | String[]            | Free-form topic/skill tags (difficulty lives on its own column)     |
| `timeLimitMs`         | Int                 | Execution time limit (per-case for standard, total for special_env) |
| `memoryLimitMb`       | Int                 | Memory limit                                                        |
| `judgeConfig`         | Json?               | Unified judge configuration (ignored when `type === "special_env"`) |
| `samples`             | Json?               | `{ input, output }[]` sample I/O pairs                              |
| `advancedImageRef`    | String?             | TA image registry ref or tarball storage key (special_env only)     |
| `advancedImageSource` | ProblemImageSource? | `registry` or `tarball` (special_env only)                          |

### Submission

| Field           | Type             | Notes                                                                                      |
| --------------- | ---------------- | ------------------------------------------------------------------------------------------ |
| `status`        | SubmissionStatus | Judge progress/verdict                                                                     |
| `score`         | Int              | 0-100                                                                                      |
| `sampleOnly`    | Boolean          | `true` for in-editor sample runs — never graded                                            |
| `verdictDetail` | Json?            | Full `SubmissionResult`: per-case + per-subtask results, compiler output, scoring feedback |

"Mode" is not a stored column — it's derived from the FK shape: `contestId` ? "contest" : `courseAssessmentId` ? "assignment" : "practice".

Indexed on: `[problemId, createdAt]`, `[userId, createdAt]`, `[courseId, courseAssessmentId, createdAt]`, `[contestParticipationId, problemId, createdAt]`, `[contestId, problemId, createdAt]`.

### Contest

Supports both standalone and course-linked contests. Features:

- ICPC/IOI scoring modes
- Scoreboard freeze time
- Submit cooldown (seconds)
- Page lock (prevent new tabs)
- IP binding (lock user to registration IP)
- IP whitelist with violation modes (block/notify)
- Max attempt limits
- Allowed language restrictions

### CourseAssessment

Course-scoped assignment with:

- Timeline: `opensAt` → `dueAt` → `closesAt`
- Same security features as Contest (page lock, IP binding, etc.)
- Scoreboard modes: hidden, live, frozen

### TestcaseSet / Testcase

Testcases organized into named sets with weights for subtask scoring. Every `TestcaseSet` row is a graded subtask — sample I/O pairs live on `Problem.samples` instead. Each testcase has `input`, `output`, and an ordinal for ordering.

### ProblemWorkspaceFile

Per-language files that make up a Standard Mode problem's workspace. Columns: `language`, `path`, `content`, `visibility` (`editable` / `readonly` / `hidden`), `orderIndex`. Hidden files are never exposed to students but are merged into the sandbox at judge time. Edit access is whole-file: `editable` means the student can replace the file; `readonly` and `hidden` are protected server-side in `mergeSandboxSources()`.

Advanced Mode (`Problem.type === "special_env"`) does not use `TestcaseSet` / `Testcase` rows — the TA-provided Docker image bundles its own testcases and writes a structured `result.json`. See [Judge Pipeline](JUDGE_PIPELINE.md#advanced-mode-pipeline).

### Plagiarism state (inlined)

Plagiarism reports are not a separate model — the six `plagiarism*` columns (`plagiarismStatus`, `plagiarismResults`, `plagiarismReportUrl`, `plagiarismTriggeredAt`, `plagiarismCompletedAt`, `plagiarismTriggeredById`) live directly on `CourseAssessment`, `Exam`, and `Contest`. One latest run per parent row; re-running upserts in place. Created by the web endpoint, processed by the Temporal plagiarism activity.

### Clarification

Public-but-anonymous Q&A attached to a `contextType` (contest / exam / assignment) + `contextId`, optionally scoped to a specific `problemId`. `askedByUserId` is always stored for accountability; the API projection masks the asker from non-staff viewers and only staff see the true identity. Lifecycle states: `pending` → `answered` | `dismissed`. See `packages/db/prisma/schema/clarification.prisma`.

### Notification

One row per event per recipient. `type` is a `NotificationType` enum (e.g. `assignment_due_soon`, `exam_starting_soon`, `clarification_answered`); `params` holds the per-type payload as JSON and the frontend renders user-facing text from `(type, params)` via paraglide. `readAt IS NULL` marks a notification as unread. Written by domain fan-out helpers (e.g. `fanoutExamStartingSoon`) that are typically invoked from Temporal activities. See `packages/db/prisma/schema/notification.prisma`.

## Complete Model Index

33 models in total. The sections above detail the high-traffic / core models; everything else lives here for navigation. For exact column definitions, open the schema file — this table is deliberately one-line-per-model so it stays easy to keep in sync.

| Model                     | Purpose                                                                     | Schema file                   |
| ------------------------- | --------------------------------------------------------------------------- | ----------------------------- |
| `User`                    | Central identity (better-auth core + platform role, status, disabled flag)  | `schema/auth.prisma`          |
| `Session`                 | better-auth session row (opaque token, expiry, IP, UA)                      | `schema/auth.prisma`          |
| `Account`                 | better-auth OAuth provider link (GitHub, Google) or password account        | `schema/auth.prisma`          |
| `Verification`            | better-auth email / OTP verification token store                            | `schema/auth.prisma`          |
| `SchoolVerificationToken` | School-email verification flow (separate from better-auth's Verification)   | `schema/auth.prisma`          |
| `Clarification`           | Public Q&A for contests / exams / assignments (asker masked to non-staff)   | `schema/clarification.prisma` |
| `Contest`                 | Standalone public CP event — no proctoring fields                           | `schema/contest.prisma`       |
| `ContestProblem`          | Join table: problems attached to a contest with ordinal + points            | `schema/contest.prisma`       |
| `ContestParticipation`    | Per-user contest state (score, penalty, status, subtaskScores)              | `schema/contest.prisma`       |
| `Exam`                    | Course-embedded proctored exam (page lock, IP whitelist / binding)          | `schema/contest.prisma`       |
| `ExamProblem`             | Join table: problems attached to an exam with ordinal + points              | `schema/contest.prisma`       |
| `ExamParticipation`       | Per-user exam state + `ipPin` for IP-binding enforcement                    | `schema/contest.prisma`       |
| `IpViolationLog`          | Audit rows for IP whitelist / binding violations — exam-only                | `schema/contest.prisma`       |
| `ActiveExamSession`       | Phase 4 exam lock — one row per active `(user, exam)`; `endedAt` closes it  | `schema/contest.prisma`       |
| `ExamSessionEvent`        | Append-only audit log per `ActiveExamSession` (enter / leave / release / …) | `schema/contest.prisma`       |
| `Course`                  | Course container (title, owner, archived flag)                              | `schema/course.prisma`        |
| `CourseMembership`        | `(course, user, role)` with `active` / `removed` status + audit trail       | `schema/course.prisma`        |
| `CourseAssessment`        | Homework assignment (opens / due / close, adjustment rules, no proctoring)  | `schema/course.prisma`        |
| `CourseAssessmentProblem` | Join table: problems attached to an assessment with ordinal + points        | `schema/course.prisma`        |
| `Notification`            | Per-recipient event row (type + params JSON, `readAt` for unread state)     | `schema/notification.prisma`  |
| `Announcement`            | Platform / course announcement (pinned, audience, published window)         | `schema/ops.prisma`           |
| `AnnouncementTranslation` | Per-locale title + body for an Announcement                                 | `schema/ops.prisma`           |
| `Problem`                 | Problem metadata (type, difficulty, limits, judge config, samples)          | `schema/problem.prisma`       |
| `ProblemStatementI18n`    | Per-locale problem statement (title, body, input / output format)           | `schema/problem.prisma`       |
| `TestcaseSet`             | Named subtask on a problem (weight, scoring strategy)                       | `schema/problem.prisma`       |
| `Testcase`                | Individual graded case (S3 keys for input / output / aux files)             | `schema/problem.prisma`       |
| `ProblemWorkspaceFile`    | Per-language workspace file (path, content S3 key, visibility, order)       | `schema/problem.prisma`       |
| `Submission`              | Judge submission row (source code, verdict, score, mode derived from FKs)   | `schema/submission.prisma`    |
| `SubmissionRejudgeLog`    | Two-pass audit log for rejudge runs (snapshot of old / new verdict + score) | `schema/submission.prisma`    |
| `ScoreOverride`           | Staff-only manual score override per `(user, problem, context)`             | `schema/submission.prisma`    |
| `ScoreOverrideAuditLog`   | Append-only create / update / delete trail for `ScoreOverride`              | `schema/submission.prisma`    |
| `Editorial`               | Per-`(user, problem, language)` editorial / writeup                         | `schema/submission.prisma`    |
| `UserDailyActivity`       | Per-`(user, UTC day)` aggregate for streaks / heatmaps                      | `schema/submission.prisma`    |

Deep field-level detail intentionally stays in the Prisma schema files themselves — treat the `.prisma` file as the source of truth for column types, defaults, indexes, and FK cascade rules.

## JSON Columns

| Model.Field                          | Schema                  | Purpose                                                                              |
| ------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------ |
| `Problem.judgeConfig`                | `JudgeConfig`           | type / compare / checker / interactor / runtime / subtaskStrategies                  |
| `Problem.samples`                    | `{ input, output }[]`   | Sample I/O pairs rendered on the student problem page                                |
| `CourseAssessment.adjustmentRules`   | `AdjustmentRule[]`      | Late penalty / time bonus / memory penalty rules (applied post-judge)                |
| `Contest.adjustmentRules`            | `AdjustmentRule[]`      | Same as above, applied to contest submissions                                        |
| `Submission.verdictDetail`           | Full `SubmissionResult` | Per-case + per-subtask results, compiler output, scoring feedback                    |
| `ContestParticipation.subtaskScores` | Score breakdown         | Per-subtask contest scores                                                           |
| `*.plagiarismResults`                | Dolos result array      | Similarity pairs (similarity, longest, overlap) on CourseAssessment / Exam / Contest |

## Seed Data

Run `pnpm db:seed` to populate development data. Validation with `pnpm db:seed:validate`.

Seed includes: 7 users (password: `password123`), 5 problems, 2 contests, 2 courses with memberships, assessments, and join tokens.

## Related Docs

- [Architecture Overview](../ARCHITECTURE.md)
- [Judge Pipeline](JUDGE_PIPELINE.md)
- [Security Requirements](SECURITY.md)
