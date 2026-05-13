-- Drop the `archived` enum value from Contest.visibility / Exam.status /
-- CourseAssessment.status. The product no longer distinguishes "ended"
-- from "archived" for these three: time alone (endsAt / closesAt) makes
-- something past-tense, and course.archived already cascades to hide
-- finished work from students. Only Course keeps a manual archive flag.

-- Migrate any pre-existing archived rows back to `published` so the
-- column data fits the redefined enum.
UPDATE "Contest" SET "visibility" = 'published' WHERE "visibility" = 'archived';
UPDATE "CourseAssessment" SET "status" = 'published' WHERE "status" = 'archived';
UPDATE "Exam" SET "status" = 'published' WHERE "status" = 'archived';

-- Postgres has no ALTER TYPE DROP VALUE — rebuild each enum.

ALTER TYPE "ContestVisibility" RENAME TO "ContestVisibility_old";
CREATE TYPE "ContestVisibility" AS ENUM ('draft', 'published');
ALTER TABLE "Contest"
  ALTER COLUMN "visibility" DROP DEFAULT,
  ALTER COLUMN "visibility" TYPE "ContestVisibility"
    USING ("visibility"::text::"ContestVisibility"),
  ALTER COLUMN "visibility" SET DEFAULT 'draft';
DROP TYPE "ContestVisibility_old";

ALTER TYPE "CourseAssessmentStatus" RENAME TO "CourseAssessmentStatus_old";
CREATE TYPE "CourseAssessmentStatus" AS ENUM ('draft', 'published');
ALTER TABLE "CourseAssessment"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "CourseAssessmentStatus"
    USING ("status"::text::"CourseAssessmentStatus"),
  ALTER COLUMN "status" SET DEFAULT 'draft';
DROP TYPE "CourseAssessmentStatus_old";

ALTER TYPE "ExamStatus" RENAME TO "ExamStatus_old";
CREATE TYPE "ExamStatus" AS ENUM ('draft', 'published');
ALTER TABLE "Exam"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "ExamStatus"
    USING ("status"::text::"ExamStatus"),
  ALTER COLUMN "status" SET DEFAULT 'draft';
DROP TYPE "ExamStatus_old";
