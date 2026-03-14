-- AlterEnum
BEGIN;
CREATE TYPE "SubmissionMode_new" AS ENUM ('practice', 'contest', 'assignment');
ALTER TABLE "Submission" ALTER COLUMN "mode" TYPE "SubmissionMode_new" USING ("mode"::text::"SubmissionMode_new");
ALTER TYPE "SubmissionMode" RENAME TO "SubmissionMode_old";
ALTER TYPE "SubmissionMode_new" RENAME TO "SubmissionMode";
DROP TYPE "public"."SubmissionMode_old";
COMMIT;

-- DropIndex
DROP INDEX "CourseAssessment_courseId_type_status_idx";

-- AlterTable
ALTER TABLE "Contest" ADD COLUMN     "allowedLanguages" "SupportedLanguage"[] DEFAULT ARRAY[]::"SupportedLanguage"[],
ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "ipLockEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxAttempts" INTEGER,
ADD COLUMN     "pageLockEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scoreboardMode" "CourseAssessmentScoreboardMode" NOT NULL DEFAULT 'live';

-- AlterTable
ALTER TABLE "CourseAssessment" DROP COLUMN "type",
ADD COLUMN     "allowedLanguages" "SupportedLanguage"[] DEFAULT ARRAY[]::"SupportedLanguage"[];

-- AlterTable
ALTER TABLE "PlagiarismReport" ADD COLUMN     "contestId" TEXT,
ALTER COLUMN "courseAssessmentId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "contestId" TEXT;

-- DropEnum
DROP TYPE "CourseAssessmentType";

-- CreateIndex
CREATE INDEX "CourseAssessment_courseId_status_idx" ON "CourseAssessment"("courseId", "status");

-- CreateIndex
CREATE INDEX "Submission_contestId_problemId_createdAt_idx" ON "Submission"("contestId", "problemId", "createdAt");

-- AddForeignKey
ALTER TABLE "Contest" ADD CONSTRAINT "Contest_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlagiarismReport" ADD CONSTRAINT "PlagiarismReport_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
