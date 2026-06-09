-- Backfill: shipped in PR #100 via `db push` only, never committed as a migration.
ALTER TABLE "CourseAssessment" ADD COLUMN "attemptResetMinuteOfDay" INTEGER;
