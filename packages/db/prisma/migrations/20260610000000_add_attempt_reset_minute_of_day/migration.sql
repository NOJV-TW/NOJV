-- Backfill: shipped in PR #100 via `db push` only, never committed as a migration.
-- IF NOT EXISTS guards against real DBs where 20260611021343 already applied this column.
ALTER TABLE "CourseAssessment" ADD COLUMN IF NOT EXISTS "attemptResetMinuteOfDay" INTEGER;
