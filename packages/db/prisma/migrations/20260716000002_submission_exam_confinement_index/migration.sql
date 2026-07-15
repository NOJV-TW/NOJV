CREATE INDEX CONCURRENTLY "Submission_userId_examId_sampleOnly_createdAt_id_idx"
ON "Submission"("userId", "examId", "sampleOnly", "createdAt" DESC, "id" DESC);
