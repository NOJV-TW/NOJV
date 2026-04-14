-- Split Contest into Exam (course-embedded) and Contest (standalone).
--
-- Architectural decision 2026-04-14: Exam and Contest used to share
-- the Contest table (nullable courseId). They have fundamentally
-- different permissions and proctoring defaults — this migration
-- moves every row with courseId IS NOT NULL into the new Exam table,
-- drops courseId + all proctoring fields from Contest, and points
-- IpViolationLog at Exam (proctoring only exists on exams now).
--
-- Safety: wrapped in a single transaction. If any copy, delete, or
-- drop fails the entire migration is rolled back. Local dev only —
-- production has no data to migrate yet.

BEGIN;

-- ─── 1. New enums ───────────────────────────────────────────────

CREATE TYPE "ExamStatus" AS ENUM ('draft', 'published', 'archived');
CREATE TYPE "ExamScoringMode" AS ENUM ('problem_count', 'point_sum');
CREATE TYPE "ExamParticipationStatus" AS ENUM ('registered', 'active', 'submitted', 'disqualified');

-- ─── 2. New tables ──────────────────────────────────────────────

CREATE TABLE "Exam" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "status" "ExamStatus" NOT NULL DEFAULT 'draft',
  "scoringMode" "ExamScoringMode" NOT NULL DEFAULT 'point_sum',
  "scoreboardMode" "ScoreboardMode" NOT NULL DEFAULT 'hidden',
  "frozenBoard" BOOLEAN NOT NULL DEFAULT false,
  "frozenAt" TIMESTAMP(3),
  "submitCooldownSec" INTEGER NOT NULL DEFAULT 0,
  "allowedLanguages" "SupportedLanguage"[] DEFAULT ARRAY[]::"SupportedLanguage"[],
  "pageLockEnabled" BOOLEAN NOT NULL DEFAULT false,
  "ipWhitelistEnabled" BOOLEAN NOT NULL DEFAULT false,
  "ipBindingEnabled" BOOLEAN NOT NULL DEFAULT false,
  "ipWhitelist" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "ipViolationMode" "IpViolationMode" NOT NULL DEFAULT 'block',
  "plagiarismStatus" "PlagiarismReportStatus",
  "plagiarismResults" JSONB,
  "plagiarismMossReportUrl" TEXT,
  "plagiarismTriggeredAt" TIMESTAMP(3),
  "plagiarismCompletedAt" TIMESTAMP(3),
  "plagiarismTriggeredById" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Exam_courseId_idx" ON "Exam"("courseId");
CREATE INDEX "Exam_courseId_status_idx" ON "Exam"("courseId", "status");

CREATE TABLE "ExamProblem" (
  "id" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "problemId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "points" INTEGER NOT NULL DEFAULT 100,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExamProblem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExamProblem_examId_problemId_key" ON "ExamProblem"("examId", "problemId");
CREATE UNIQUE INDEX "ExamProblem_examId_ordinal_key" ON "ExamProblem"("examId", "ordinal");

CREATE TABLE "ExamParticipation" (
  "id" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "ExamParticipationStatus" NOT NULL DEFAULT 'registered',
  "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3),
  "disqualifiedAt" TIMESTAMP(3),
  "disqualifiedReason" TEXT,
  "score" INTEGER NOT NULL DEFAULT 0,
  "penaltySeconds" INTEGER NOT NULL DEFAULT 0,
  "subtaskScores" JSONB,
  "ipPin" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExamParticipation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExamParticipation_examId_userId_key" ON "ExamParticipation"("examId", "userId");
CREATE INDEX "ExamParticipation_userId_status_idx" ON "ExamParticipation"("userId", "status");

-- Foreign keys (deferred after table creation so the copy step can
-- move rows without tripping FK order).
ALTER TABLE "Exam"
  ADD CONSTRAINT "Exam_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Exam_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Exam_plagiarismTriggeredById_fkey" FOREIGN KEY ("plagiarismTriggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ExamProblem"
  ADD CONSTRAINT "ExamProblem_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ExamProblem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExamParticipation"
  ADD CONSTRAINT "ExamParticipation_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ExamParticipation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 3. Copy course-embedded Contest rows → Exam ────────────────
--
-- `status` (Exam) reuses `visibility` (Contest). Current values
-- (draft/published/archived) line up 1:1 with the ExamStatus enum.
-- `scoringMode` also lines up (problem_count/point_sum). Cast via
-- ::text::<newenum> to satisfy the type system.

INSERT INTO "Exam" (
  "id", "courseId", "title", "summary", "startsAt", "endsAt",
  "status", "scoringMode", "scoreboardMode", "frozenBoard", "frozenAt",
  "submitCooldownSec", "allowedLanguages",
  "pageLockEnabled", "ipWhitelistEnabled", "ipBindingEnabled",
  "ipWhitelist", "ipViolationMode",
  "plagiarismStatus", "plagiarismResults", "plagiarismMossReportUrl",
  "plagiarismTriggeredAt", "plagiarismCompletedAt", "plagiarismTriggeredById",
  "createdByUserId", "createdAt", "updatedAt"
)
SELECT
  "id", "courseId", "title", "summary", "startsAt", "endsAt",
  "visibility"::text::"ExamStatus",
  "scoringMode"::text::"ExamScoringMode",
  "scoreboardMode", "frozenBoard", "frozenAt",
  "submitCooldownSec", "allowedLanguages",
  "pageLockEnabled", "ipWhitelistEnabled", "ipBindingEnabled",
  "ipWhitelist", "ipViolationMode",
  "plagiarismStatus", "plagiarismResults", "plagiarismMossReportUrl",
  "plagiarismTriggeredAt", "plagiarismCompletedAt", "plagiarismTriggeredById",
  "createdByUserId", "createdAt", "updatedAt"
FROM "Contest"
WHERE "courseId" IS NOT NULL;

-- ─── 4. Copy ContestProblem → ExamProblem for those contests ────

INSERT INTO "ExamProblem" (
  "id", "examId", "problemId", "ordinal", "points", "createdAt"
)
SELECT
  cp."id", cp."contestId", cp."problemId", cp."ordinal", cp."points", cp."createdAt"
FROM "ContestProblem" cp
JOIN "Contest" c ON c."id" = cp."contestId"
WHERE c."courseId" IS NOT NULL;

-- ─── 5. Copy ContestParticipation → ExamParticipation ──────────
--
-- ContestParticipationStatus enum (registered/active/submitted/
-- disqualified) maps 1:1 to ExamParticipationStatus. No boundIp or
-- boundIpClearedAt on exams — those were contest-era fields now
-- replaced by the new `ipPin` column (null after migration).

INSERT INTO "ExamParticipation" (
  "id", "examId", "userId", "status", "registeredAt", "startedAt",
  "submittedAt", "score", "penaltySeconds", "subtaskScores",
  "createdAt", "updatedAt"
)
SELECT
  cpt."id", cpt."contestId", cpt."userId",
  cpt."status"::text::"ExamParticipationStatus",
  cpt."createdAt",
  cpt."startedAt", cpt."submittedAt",
  cpt."score", cpt."penaltySeconds", cpt."subtaskScores",
  cpt."createdAt", cpt."updatedAt"
FROM "ContestParticipation" cpt
JOIN "Contest" c ON c."id" = cpt."contestId"
WHERE c."courseId" IS NOT NULL;

-- ─── 6. Split Submission.contestId → examId ────────────────────

ALTER TABLE "Submission" ADD COLUMN "examId" TEXT;

UPDATE "Submission" s
SET "examId" = s."contestId",
    "contestId" = NULL
FROM "Contest" c
WHERE s."contestId" = c."id" AND c."courseId" IS NOT NULL;

ALTER TABLE "Submission"
  ADD CONSTRAINT "Submission_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Submission_examId_problemId_createdAt_idx" ON "Submission"("examId", "problemId", "createdAt");

-- Submission xor: a row carries at most one of (examId, contestId).
ALTER TABLE "Submission"
  ADD CONSTRAINT "Submission_source_xor" CHECK (NOT ("examId" IS NOT NULL AND "contestId" IS NOT NULL));

-- Submission.contest FK previously was onDelete: SetNull. The schema
-- now declares onDelete: Cascade to match the new Exam relation —
-- standalone contests delete their submissions instead of orphaning
-- them (they never had course-side retention requirements). Drop and
-- re-create the constraint to match.
ALTER TABLE "Submission" DROP CONSTRAINT IF EXISTS "Submission_contestId_fkey";
ALTER TABLE "Submission"
  ADD CONSTRAINT "Submission_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 7. IpViolationLog: replace contestId → examId ─────────────

ALTER TABLE "IpViolationLog" ADD COLUMN "examId" TEXT;

UPDATE "IpViolationLog" ivl
SET "examId" = ivl."contestId"
FROM "Contest" c
WHERE c."id" = ivl."contestId" AND c."courseId" IS NOT NULL;

-- Any log row that referenced a standalone contest can't have
-- happened (contests had no proctoring gates at the time — the logs
-- were always course-embedded), but the SET NOT NULL step below
-- would fail defensively if such a row existed. Drop them first to
-- keep the migration idempotent against weird test states.
DELETE FROM "IpViolationLog" WHERE "examId" IS NULL;

ALTER TABLE "IpViolationLog" ALTER COLUMN "examId" SET NOT NULL;
ALTER TABLE "IpViolationLog" DROP CONSTRAINT IF EXISTS "IpViolationLog_contestId_fkey";
DROP INDEX IF EXISTS "IpViolationLog_contestId_createdAt_idx";
ALTER TABLE "IpViolationLog" DROP COLUMN "contestId";
CREATE INDEX "IpViolationLog_examId_createdAt_idx" ON "IpViolationLog"("examId", "createdAt");
ALTER TABLE "IpViolationLog"
  ADD CONSTRAINT "IpViolationLog_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 8. Delete migrated Contest rows ───────────────────────────
--
-- CASCADE on ContestProblem / ContestParticipation removes their
-- rows automatically. Submissions that still reference the parent
-- Contest row via the FK have already been redirected to examId
-- above, so the DELETE here only sweeps the parent.

DELETE FROM "ContestProblem" cp
USING "Contest" c
WHERE cp."contestId" = c."id" AND c."courseId" IS NOT NULL;

DELETE FROM "ContestParticipation" cpt
USING "Contest" c
WHERE cpt."contestId" = c."id" AND c."courseId" IS NOT NULL;

DELETE FROM "Contest" WHERE "courseId" IS NOT NULL;

-- ─── 9. Drop Contest.courseId + proctoring columns ─────────────

ALTER TABLE "Contest" DROP CONSTRAINT IF EXISTS "Contest_courseId_fkey";
ALTER TABLE "Contest" DROP COLUMN IF EXISTS "courseId";
ALTER TABLE "Contest" DROP COLUMN IF EXISTS "pageLockEnabled";
ALTER TABLE "Contest" DROP COLUMN IF EXISTS "ipWhitelistEnabled";
ALTER TABLE "Contest" DROP COLUMN IF EXISTS "ipBindingEnabled";
ALTER TABLE "Contest" DROP COLUMN IF EXISTS "ipWhitelist";
ALTER TABLE "Contest" DROP COLUMN IF EXISTS "ipViolationMode";

COMMIT;
