-- AlterTable
ALTER TABLE "SubmissionRejudgeLog" ADD COLUMN "rejudgeRunId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionRejudgeLog_submissionId_rejudgeRunId_key" ON "SubmissionRejudgeLog"("submissionId", "rejudgeRunId");
