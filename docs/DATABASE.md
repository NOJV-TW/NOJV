# Database Schema

PostgreSQL 18 with Prisma 7. Schema split across `packages/db/prisma/schema/*.prisma` (auth, config, contest, course, ops, problem, submission).

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
          ├── PlagiarismReport
          └── IpViolationLog

Course ──┬── CourseMembership
         ├── CourseJoinToken
         ├── CourseAssessment ──┬── CourseAssessmentProblem
         │                     ├── AssessmentParticipation
         │                     ├── PlagiarismReport
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
| `ProblemType`             | full_source, function, multi_file, special_env                                                                               |
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
| `type`                | ProblemType         | full_source, function, multi_file, or special_env                   |
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

### PlagiarismReport

Tracks MOSS plagiarism detection runs. Created by web endpoint, processed by Temporal workflow. Links to either `CourseAssessment` or `Contest`.

## JSON Columns

| Model.Field                          | Schema                  | Purpose                                                               |
| ------------------------------------ | ----------------------- | --------------------------------------------------------------------- |
| `Problem.judgeConfig`                | `JudgeConfig`           | type / compare / checker / interactor / runtime / subtaskStrategies   |
| `Problem.samples`                    | `{ input, output }[]`   | Sample I/O pairs rendered on the student problem page                 |
| `CourseAssessment.adjustmentRules`   | `AdjustmentRule[]`      | Late penalty / time bonus / memory penalty rules (applied post-judge) |
| `Contest.adjustmentRules`            | `AdjustmentRule[]`      | Same as above, applied to contest submissions                         |
| `Submission.verdictDetail`           | Full `SubmissionResult` | Per-case + per-subtask results, compiler output, scoring feedback     |
| `ContestParticipation.subtaskScores` | Score breakdown         | Per-subtask contest scores                                            |
| `PlagiarismReport.results`           | MOSS result array       | Similarity pairs and percentages                                      |

## Seed Data

Run `pnpm db:seed` to populate development data. Validation with `pnpm db:seed:validate`.

Seed includes: 7 users (password: `password123`), 5 problems, 2 contests, 2 courses with memberships, assessments, and join tokens.

## Related Docs

- [Architecture Overview](../ARCHITECTURE.md)
- [Judge Pipeline](JUDGE_PIPELINE.md)
- [Security Requirements](SECURITY.md)
