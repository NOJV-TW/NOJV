-- Drop unique index then column on CourseAssessment
DROP INDEX "CourseAssessment_courseId_slug_key";
ALTER TABLE "CourseAssessment" DROP COLUMN "slug";

-- Drop unique index then column on Contest
DROP INDEX "Contest_slug_key";
ALTER TABLE "Contest" DROP COLUMN "slug";
