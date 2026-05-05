-- Drop the single-column `Exam(courseId)` index. The composite
-- `Exam(courseId, status)` index already covers prefix scans on `courseId`
-- alone (PostgreSQL's planner uses the leading column of a composite index),
-- so the standalone index is redundant.
DROP INDEX "Exam_courseId_idx";

-- Drop `ExamParticipation.disqualifiedReason`. Verified zero reads/writes
-- across packages/ and apps/ (grep returned no matches). The disqualification
-- timestamp lives on `disqualifiedAt`; no UI or domain code persists a reason.
ALTER TABLE "ExamParticipation" DROP COLUMN "disqualifiedReason";
