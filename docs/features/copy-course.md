# Feature: Copy Course

Acceptance spec for `copyCourse`: a single-transaction clone of a course's structure (assignments, exams and their problem attachments) into a new course owned by the actor, without roster, submissions or history. Started from the course Settings tab.

## Key code

- `packages/application/src/course/mutations.ts` — `copyCourse`, `assertCourseManager`
- `packages/application/src/course/queries.ts` — `getCopyCoursePreview`
- `packages/application/src/problem/fork.ts` — `resolveActivityProblems`
- `packages/core/src/schemas/course.ts` — `copyCourseSchema`
- `apps/web/src/routes/(app)/courses/[courseId]/settings/+page.server.ts` — `copyCourse` action
- Tests: `tests/unit/application/course-copy.test.ts`

## Problem ownership

Rules from PRB-10.

- The actor's own private problems, including drafts, are reused.
- Every published public source, including the actor's own, becomes a new actor-owned private fork. Each distinct source problem is resolved once and reused across all copied activities.
- Another owner's private problem is rejected, even for admins and even if it is shared with the source course: source-course co-edit access never authorizes sharing it with the new course. A public draft fails the published-public-source check.
- Resolved problems are shared with the new course (`CourseProblem`). Library-only problems with no activity attachment are not copied.
- The new course, membership, activities, attachments, forks and library relations commit together; any failure rolls back everything.

## What is copied

| Target              | Values                                                                                                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Course`            | `title = newTitle.trim()`, source `description`, `academicYear` and `semester` when set, `ownerId = actor`, not archived                                                                                                                              |
| `CourseMembership`  | exactly one: actor as `teacher`, `status: active`, `addedByUserId = actor`                                                                                                                                                                            |
| `Assessment`        | every source assignment as `draft`, `createdByUserId = actor`, new id; `title`, `summary`, `allowedLanguages`, `opensAt`, `dueAt`, `closesAt`, `totalPoints`, `maxAttemptsPerDay`, `attemptResetMinuteOfDay`, `adjustmentRules`                       |
| `Exam`              | every source exam as `draft`, `createdByUserId = actor`, new id; `title`, `summary`, `startsAt`, `dueAt`, `endsAt`, `adjustmentRules`, `totalPoints`, `allowedLanguages`, `scoringMode`, `scoreboardMode`, `submitCooldownSec`, all proctoring fields |
| `AssessmentProblem` | every attachment with its `ordinal` and `points`, `problemId` mapped under the ownership rules                                                                                                                                                        |
| `ExamProblem`       | same as `AssessmentProblem`                                                                                                                                                                                                                           |

Not copied: other memberships, library-only problems, submissions, participations, exam sessions, IP violation logs, plagiarism results, grading data (overrides, feedback, audit logs), `detachedProblemIds`, and `examPasswordEnabled` (new exams start with it off).

## Acceptance criteria

### Permission

- The actor must be a platform admin, or hold a bound, active `teacher` or `ta` membership in the source course; otherwise `ForbiddenError("You do not have permission to manage this course.")`. Students, pending usernames and removed memberships are denied. Admins need no membership.

### Validation

- `newTitle` is required and trimmed: blank → `ValidationError("New course title is required.")`; over 120 characters → `ValidationError("New course title must be 120 characters or fewer.")`.
- Unknown source: `NotFoundError(\`Course not found: ${sourceCourseId}\`)`.

### Result

- Returns `{ newCourseId }`. The actor is the sole teacher, whatever their source role; an admin copying for another teacher must change ownership afterwards.
- Every copied activity is a draft, so nothing publishes with stale timing. Source archive state is never carried.
- A source with no activities yields a course with only the teacher membership.

### Concurrency and route

- The source `Course` row is locked before authorization and reads, so concurrent copies serialize and each creates its own target course.
- The Settings action is rate limited (`withAction`), validates the title with `copyCourseSchema` (400 `invalid_title` on failure), and redirects 303 to `/courses/${newCourseId}/settings`.
