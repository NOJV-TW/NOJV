# Database Schema

PostgreSQL 18 with Prisma 7. Schema at `packages/db/prisma/schema.prisma` (584 lines, 20+ models).

## Domain Model Overview

```
User ──┬── Session
       ├── Account (OAuth: GitHub, Google)
       ├── Submission ──→ Problem
       ├── ContestParticipation ──→ Contest
       ├── CourseMembership ──→ Course
       ├── AssessmentParticipation ──→ CourseAssessment
       ├── UserStats
       ├── Editorial
       └── IpViolationLog

Problem ──┬── ProblemStatementI18n (locale-specific content)
          ├── TestcaseSet ──→ Testcase (standard mode: graded only)
          ├── ProblemWorkspaceFile (per-language files with visibility + editable regions)
          ├── AdvancedTestcase (advanced mode only)
          ├── ContestProblem ──→ Contest
          ├── CourseProblem ──→ Course
          ├── CourseAssessmentProblem ──→ CourseAssessment
          └── Editorial

Contest ──┬── ContestProblem
          ├── ContestParticipation
          ├── Submission
          ├── PlagiarismReport
          └── IpViolationLog

Course ──┬── CourseMembership
         ├── CourseJoinToken
         ├── CourseProblem
         ├── CourseAssessment ──┬── CourseAssessmentProblem
         │                     ├── AssessmentParticipation
         │                     ├── PlagiarismReport
         │                     └── IpViolationLog
         ├── Contest (course-linked)
         └── Submission
```

## Enums

| Enum                             | Values                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `SupportedLanguage`              | c, cpp, go, java, javascript, python, rust, typescript                                                                       |
| `SubmissionMode`                 | practice, contest, assignment                                                                                                |
| `SubmissionStatus`               | queued, compiling, running, accepted, wrong_answer, time_limit_exceeded, memory_limit_exceeded, runtime_error, compile_error |
| `JudgeType`                      | standard, checker, interactive                                                                                               |
| `SubmissionType`                 | function, full_source                                                                                                        |
| `PlatformRole`                   | admin, teacher, student                                                                                                      |
| `CourseRole`                     | teacher, ta, student                                                                                                         |
| `ContestVisibility`              | draft, published, archived                                                                                                   |
| `ContestScoringMode`             | icpc, ioi                                                                                                                    |
| `CourseVisibility`               | invite_only, listed, archived                                                                                                |
| `CourseMembershipStatus`         | active, invited, pending, removed                                                                                            |
| `CourseJoinMethod`               | qr_code, join_code, manual_invite                                                                                            |
| `ProblemVisibility`              | public, private                                                                                                              |
| `CourseAssessmentStatus`         | draft, published, archived                                                                                                   |
| `CourseAssessmentScoreboardMode` | hidden, live, frozen                                                                                                         |
| `ContestParticipationStatus`     | registered, active, submitted, disqualified                                                                                  |
| `PlagiarismReportStatus`         | pending, running, completed, failed                                                                                          |

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

| Field            | Type              | Notes                                 |
| ---------------- | ----------------- | ------------------------------------- |
| `id`             | String            | CUID, primary key                     |
| `defaultTitle`   | String            | Problem title                         |
| `visibility`     | ProblemVisibility | public or private (course-only)       |
| `status`         | ProblemStatus     | draft or published                    |
| `submissionType` | SubmissionType    | function, full_source, or zip_project |
| `timeLimitMs`    | Int               | Execution time limit                  |
| `memoryLimitMb`  | Int               | Memory limit                          |
| `judgeConfig`    | Json?             | Unified judge configuration           |

### Submission

| Field            | Type             | Notes                                     |
| ---------------- | ---------------- | ----------------------------------------- |
| `mode`           | SubmissionMode   | practice, contest, or assignment          |
| `status`         | SubmissionStatus | Judge progress/verdict                    |
| `score`          | Int              | 0-100                                     |
| `verdictDetail`  | Json?            | Per-testcase results                      |
| `subtaskResults` | Json?            | Per-subtask scores (IOI)                  |
| `pipelineResult` | Json?            | Static analysis, artifacts, custom scores |

Indexed on: `[problemId, createdAt]`, `[userId, createdAt]`, `[contestId, problemId, createdAt]`, `[contestParticipationId, problemId, createdAt]`.

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

Testcases organized into named sets with weights for subtask scoring. Every `TestcaseSet` row is a graded subtask — sample I/O pairs live on `Problem.samples` instead. Each testcase has stdin, expected stdout, and an ordinal for ordering.

### ProblemWorkspaceFile

Per-language files that make up a Standard Mode problem's workspace. Columns: `language`, `path`, `content`, `visibility` (`editable` / `readonly` / `hidden`), `editableRegions` (`[[startLine, endLine]]` JSON), `orderIndex`. Hidden files are never exposed to students but are merged into the sandbox at judge time. Editable regions enforce per-line read-only decorations in Monaco.

### AdvancedTestcase

Advanced Mode testcase data: `ordinal`, `stdin`, `expected`, and a `files` JSON blob holding arbitrary auxiliary file contents. The worker copies these under `/workspace/testcases/N/` when dispatching the TA-provided judge image.

### PlagiarismReport

Tracks MOSS plagiarism detection runs. Created by web endpoint, processed by Temporal workflow. Links to either `CourseAssessment` or `Contest`.

## JSON Columns

| Model.Field                            | Schema                                      | Purpose                                                                          |
| -------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------- |
| `Problem.judgeConfig`                  | `JudgeConfig`                               | type / compare / checker / interactor / runtime / subtaskStrategies              |
| `Problem.samples`                      | `{ stdin, expected }[]`                     | Sample I/O pairs rendered on the student problem page                            |
| `Problem.advancedResourceLimits`       | `{ totalTimeMs, memoryMb, networkEnabled }` | Advanced Mode only — cgroup + network limits for the TA-provided judge container |
| `ProblemWorkspaceFile.editableRegions` | `[[startLine, endLine]][]`                  | Monaco read-only decoration ranges                                               |
| `AdvancedTestcase.files`               | `Record<string, string>`                    | Auxiliary files staged under `/workspace/testcases/N/files/`                     |
| `CourseAssessment.adjustmentRules`     | `AdjustmentRule[]`                          | Late penalty / time bonus / memory penalty rules (applied post-judge)            |
| `Contest.adjustmentRules`              | `AdjustmentRule[]`                          | Same as above, applied to contest submissions                                    |
| `Submission.verdictDetail`             | Per-testcase verdict array                  | Detailed judge results                                                           |
| `Submission.subtaskResults`            | Per-subtask score array                     | IOI-style partial scoring                                                        |
| `ContestParticipation.subtaskScores`   | Score breakdown                             | Per-subtask contest scores                                                       |
| `UserStats.languageDist`               | `Record<Language, number>`                  | Submission count per language                                                    |
| `UserStats.difficultyDist`             | `Record<Difficulty, number>`                | AC count per difficulty                                                          |
| `UserStats.dailyActivity`              | Date-count array                            | Submission heatmap data                                                          |
| `PlagiarismReport.results`             | MOSS result array                           | Similarity pairs and percentages                                                 |

## Seed Data

Run `pnpm db:seed` to populate development data. Validation with `pnpm db:seed:validate`.

Seed includes: 7 users (password: `password123`), 5 problems, 2 contests, 2 courses with memberships, assessments, and join tokens.

## Related Docs

- [Architecture Overview](../ARCHITECTURE.md)
- [Judge Pipeline](JUDGE_PIPELINE.md)
- [Security Requirements](SECURITY.md)
