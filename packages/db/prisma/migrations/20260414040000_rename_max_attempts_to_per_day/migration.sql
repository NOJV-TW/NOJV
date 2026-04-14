-- Rename CourseAssessment.maxAttempts → maxAttemptsPerDay.
-- Semantics change: prior column was a lifetime cap per (user, problem);
-- the new column is a per-UTC-day cap enforced at submit time by
-- packages/domain/src/submission/mutations.ts.
ALTER TABLE "CourseAssessment" RENAME COLUMN "maxAttempts" TO "maxAttemptsPerDay";
