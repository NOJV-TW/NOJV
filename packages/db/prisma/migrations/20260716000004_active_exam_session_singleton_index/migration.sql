CREATE UNIQUE INDEX CONCURRENTLY "ActiveExamSession_one_active_per_user_key"
ON "ActiveExamSession"("userId")
WHERE "endedAt" IS NULL;
