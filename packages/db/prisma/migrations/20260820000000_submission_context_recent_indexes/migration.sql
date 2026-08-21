CREATE INDEX CONCURRENTLY "Submission_assessmentId_createdAt_id_idx"
ON "Submission"("assessmentId", "createdAt" DESC, "id" DESC);

CREATE INDEX CONCURRENTLY "Submission_examId_createdAt_id_idx"
ON "Submission"("examId", "createdAt" DESC, "id" DESC);
