# Exam Draft and Publish Guidance

## Intent

Make the lifecycle of an exam obvious to course teachers and teaching assistants. A draft exam remains visible in staff course lists, but must not look like a published exam that is merely waiting for its start time.

## Goals

- Keep draft exams visible to course managers in course lists.
- Label drafts consistently as `草稿` / `Draft` in list and detail views.
- Distinguish `草稿（未發布）` from `已發布・尚未開始` in the hero status.
- Give managers a clear, persistent instruction and a prominent publish action on draft detail pages.
- Avoid presenting draft countdowns or student-facing readiness as if the exam were live.

## Non-goals

- Do not change who can view, edit, or publish an exam.
- Do not change exam persistence, scheduling, or publish validation.
- Do not hide drafts from teachers or teaching assistants.

## Decisions

- Drafts get their own `草稿` group in the course exam list instead of being grouped under `即將開始`.
- The existing detail page remains the editing surface; the draft state is communicated by the status pill, a prominent guidance panel, and a top-level publish action that links to settings.
- Published exams keep the current schedule and countdown presentation.
- Draft detail pages use a non-countdown label in the hero and a neutral draft schedule treatment while retaining configured times for editing context.
