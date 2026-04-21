-- The 2026-04-14 contest/exam split moved proctored assessments to `Exam`.
-- Contests are now public CP events and never run plagiarism scans — the
-- six inline `plagiarism*` columns on `Contest` plus the FK to the
-- triggering user have been dead since the split (verified: zero readers
-- or writers in src/ and packages/).

ALTER TABLE "Contest" DROP CONSTRAINT "Contest_plagiarismTriggeredById_fkey";

ALTER TABLE "Contest" DROP COLUMN "plagiarismStatus";
ALTER TABLE "Contest" DROP COLUMN "plagiarismResults";
ALTER TABLE "Contest" DROP COLUMN "plagiarismReportUrl";
ALTER TABLE "Contest" DROP COLUMN "plagiarismTriggeredAt";
ALTER TABLE "Contest" DROP COLUMN "plagiarismCompletedAt";
ALTER TABLE "Contest" DROP COLUMN "plagiarismTriggeredById";
