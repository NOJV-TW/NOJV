CREATE INDEX CONCURRENTLY "ScoreOverrideAuditLog_courseMembershipId_problemId_createdA_idx"
  ON "ScoreOverrideAuditLog"("courseMembershipId", "problemId", "createdAt" DESC);
CREATE INDEX CONCURRENTLY "SubmissionFeedbackAuditLog_courseMembershipId_problemId_cre_idx"
  ON "SubmissionFeedbackAuditLog"("courseMembershipId", "problemId", "createdAt" DESC);
