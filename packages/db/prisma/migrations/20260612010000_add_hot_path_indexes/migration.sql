-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Submission_createdAt_idx" ON "Submission"("createdAt");

-- CreateIndex
CREATE INDEX "SubmissionRejudgeLog_createdAt_idx" ON "SubmissionRejudgeLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");
