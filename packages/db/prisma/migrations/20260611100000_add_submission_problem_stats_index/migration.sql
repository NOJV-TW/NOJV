-- CreateIndex
CREATE INDEX "Submission_problemId_sampleOnly_userId_status_idx" ON "Submission"("problemId", "sampleOnly", "userId", "status");
