-- DropForeignKey
ALTER TABLE "ContestParticipation" DROP CONSTRAINT "ContestParticipation_contestId_fkey";

-- DropForeignKey
ALTER TABLE "ContestParticipation" DROP CONSTRAINT "ContestParticipation_userId_fkey";

-- DropForeignKey
ALTER TABLE "ExamParticipation" DROP CONSTRAINT "ExamParticipation_examId_fkey";

-- DropForeignKey
ALTER TABLE "ExamParticipation" DROP CONSTRAINT "ExamParticipation_userId_fkey";

-- DropForeignKey
ALTER TABLE "Submission" DROP CONSTRAINT "Submission_contestParticipationId_fkey";

-- DropForeignKey
ALTER TABLE "Submission" DROP CONSTRAINT "Submission_virtualContestId_fkey";

-- DropForeignKey
ALTER TABLE "VirtualContest" DROP CONSTRAINT "VirtualContest_contestId_fkey";

-- DropForeignKey
ALTER TABLE "VirtualContest" DROP CONSTRAINT "VirtualContest_userId_fkey";

-- DropIndex
DROP INDEX "Participation_contestId_idx";

-- DropIndex
DROP INDEX "Participation_examId_idx";

-- DropIndex
DROP INDEX "Submission_contestParticipationId_problemId_createdAt_idx";

-- DropIndex
DROP INDEX "Submission_virtualContestId_problemId_createdAt_idx";

-- AlterTable
ALTER TABLE "Participation" DROP COLUMN "typeData",
ADD COLUMN     "endsAt" TIMESTAMP(3),
ADD COLUMN     "ipGateExemptUntil" TIMESTAMP(3),
ADD COLUMN     "ipPin" TEXT;

-- AlterTable
ALTER TABLE "Submission" DROP COLUMN "contestParticipationId",
DROP COLUMN "virtualContestId",
ADD COLUMN     "participationId" TEXT;

-- DropTable
DROP TABLE "ContestParticipation";

-- DropTable
DROP TABLE "ExamParticipation";

-- DropTable
DROP TABLE "VirtualContest";

-- DropEnum
DROP TYPE "ContestParticipationStatus";

-- DropEnum
DROP TYPE "ExamParticipationStatus";

-- DropEnum
DROP TYPE "VirtualContestStatus";

-- CreateIndex
CREATE UNIQUE INDEX "Participation_type_contestId_userId_key" ON "Participation"("type", "contestId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Participation_type_examId_userId_key" ON "Participation"("type", "examId", "userId");

-- CreateIndex
CREATE INDEX "Submission_participationId_problemId_createdAt_idx" ON "Submission"("participationId", "problemId", "createdAt");

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_participationId_fkey" FOREIGN KEY ("participationId") REFERENCES "Participation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

