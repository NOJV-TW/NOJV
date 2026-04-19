-- CreateTable
CREATE TABLE "SubmissionRejudgeLog" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "rejudgedByUserId" TEXT,
    "oldVerdict" TEXT NOT NULL,
    "oldScore" INTEGER NOT NULL,
    "oldResultJson" JSONB,
    "newVerdict" TEXT,
    "newScore" INTEGER,
    "newResultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionRejudgeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubmissionRejudgeLog_submissionId_createdAt_idx" ON "SubmissionRejudgeLog"("submissionId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SubmissionRejudgeLog_rejudgedByUserId_createdAt_idx" ON "SubmissionRejudgeLog"("rejudgedByUserId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "SubmissionRejudgeLog" ADD CONSTRAINT "SubmissionRejudgeLog_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionRejudgeLog" ADD CONSTRAINT "SubmissionRejudgeLog_rejudgedByUserId_fkey" FOREIGN KEY ("rejudgedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
