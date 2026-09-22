CREATE INDEX CONCURRENTLY "ScoreOverrideAuditLog_assessmentId_problemId_createdAt_idx"
  ON "ScoreOverrideAuditLog"("assessmentId", "problemId", "createdAt" DESC);
CREATE INDEX CONCURRENTLY "ScoreOverrideAuditLog_examId_problemId_createdAt_idx"
  ON "ScoreOverrideAuditLog"("examId", "problemId", "createdAt" DESC);
CREATE INDEX CONCURRENTLY "ScoreOverrideAuditLog_studentUserId_problemId_createdAt_idx"
  ON "ScoreOverrideAuditLog"("studentUserId", "problemId", "createdAt" DESC);
