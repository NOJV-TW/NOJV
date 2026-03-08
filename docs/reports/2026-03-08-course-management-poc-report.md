# Course Management POC Report

## Scope

This POC extends NOJV from a general judge shell into a course-aware judge surface:

- platform roles: `admin`, `teacher`, `ta`, `student`
- course-scoped memberships
- QR code / join code / manual enrollment
- public and private problem ownership
- assignments and exams as separate course assessment surfaces

## Architecture

The implementation keeps the existing platform boundaries:

- `apps/web` owns course pages, course APIs, and role-aware management surfaces
- `apps/workspace` now carries assignment / exam context into workspace execution payloads
- `apps/worker` keeps execution isolated and applies stricter command policy for exam-like flows
- `packages/domain` validates course roles, join flows, assessments, and assessment-linked judge payloads
- `packages/db` adds relational models for courses, memberships, join tokens, problem ownership, and course assessments

## Data Model

New Prisma structures:

- `Course`
- `CourseMembership`
- `CourseJoinToken`
- `CourseProblem`
- `CourseAssessment`
- `CourseAssessmentProblem`

Existing runtime entities now optionally attach to course context:

- `Submission`
- `WorkspaceSession`
- `WorkspaceRun`
- `CheatingCase`
- `CheatingSignal`

## UI Surfaces

The web app now includes:

- `/[locale]/courses`
- `/[locale]/courses/[slug]`
- `/[locale]/courses/[slug]/assignments/[assessmentSlug]`
- `/[locale]/courses/[slug]/exams/[assessmentSlug]`

Assignments emphasize open / due / close windows. Exams emphasize rank visibility and stricter runtime policy. Both still connect to the same underlying judge and persistence path.

## API Surfaces

The course POC adds:

- `POST /api/courses`
- `POST /api/problems`
- `POST /api/courses/[slug]/join`
- `POST /api/courses/[slug]/members`
- `POST /api/courses/[slug]/problems`
- `POST /api/courses/[slug]/assessments`

Identity is currently header-driven rather than fully authenticated. That keeps the POC small while still making permission checks real.

## Known Limits

- Header-driven actor identity is a POC stand-in for auth and session management.
- Public UI pages are mostly seeded views; dynamic course creation is exercised through APIs rather than a full teacher dashboard form flow.
- Course-created problems can now receive persisted testcase sets and run through the sandbox-backed submission judge path.
- Course telemetry is persisted with assessment context, but detector breadth is still limited to the current evidence classes.
