CREATE INDEX "Submission_assessmentId_problemId_createdAt_idx" ON "Submission"("assessmentId", "problemId", "createdAt");

CREATE INDEX "Submission_status_updatedAt_idx" ON "Submission"("status", "updatedAt");
