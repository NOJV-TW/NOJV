-- CreateEnum
CREATE TYPE "ContestScoringMode" AS ENUM ('icpc', 'ioi');

-- CreateEnum
CREATE TYPE "PlagiarismReportStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN     "published" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Contest" ADD COLUMN     "courseId" TEXT,
ADD COLUMN     "frozenAt" TIMESTAMP(3),
ADD COLUMN     "scoringMode" "ContestScoringMode" NOT NULL DEFAULT 'icpc',
ADD COLUMN     "submitCooldownSec" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ContestParticipation" ADD COLUMN     "subtaskScores" JSONB;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "subtaskResults" JSONB;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "disabled" BOOLEAN NOT NULL DEFAULT false;

-- DropTable (legacy tables not in schema)
DROP TABLE IF EXISTS "CheatingSignal";
DROP TABLE IF EXISTS "CheatingCase";
DROP TABLE IF EXISTS "WorkspaceRun";
DROP TABLE IF EXISTS "WorkspaceSession";

-- DropEnum (legacy enums)
DROP TYPE IF EXISTS "CheatingCaseStatus";
DROP TYPE IF EXISTS "CheatingSignalType";
DROP TYPE IF EXISTS "WorkspaceMode";
DROP TYPE IF EXISTS "WorkspaceRunStatus";

-- CreateTable
CREATE TABLE "PlagiarismReport" (
    "id" TEXT NOT NULL,
    "courseAssessmentId" TEXT NOT NULL,
    "triggeredById" TEXT NOT NULL,
    "status" "PlagiarismReportStatus" NOT NULL DEFAULT 'pending',
    "results" JSONB,
    "mossReportUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PlagiarismReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Submission_contestParticipationId_problemId_createdAt_idx" ON "Submission"("contestParticipationId", "problemId", "createdAt");

-- AddForeignKey
ALTER TABLE "Contest" ADD CONSTRAINT "Contest_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlagiarismReport" ADD CONSTRAINT "PlagiarismReport_courseAssessmentId_fkey" FOREIGN KEY ("courseAssessmentId") REFERENCES "CourseAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlagiarismReport" ADD CONSTRAINT "PlagiarismReport_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
