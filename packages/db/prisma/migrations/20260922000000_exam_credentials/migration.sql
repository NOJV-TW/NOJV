ALTER TABLE "Session" ADD COLUMN "examPassword" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ExamCredential" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "passwordHash" TEXT,
    "passwordCiphertext" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "emailSentAt" TIMESTAMP(3),
    "emailScheduledFor" TIMESTAMP(3) NOT NULL,
    "emailStatus" TEXT NOT NULL DEFAULT 'pending',
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExamCredential_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ExamCredential" ADD CONSTRAINT "ExamCredential_revision_check" CHECK ("revision" > 0);
ALTER TABLE "ExamCredential" ADD CONSTRAINT "ExamCredential_material_check" CHECK (
  ("revokedAt" IS NULL AND "passwordHash" IS NOT NULL AND "passwordCiphertext" IS NOT NULL)
  OR ("revokedAt" IS NOT NULL AND "passwordHash" IS NULL AND "passwordCiphertext" IS NULL)
);
ALTER TABLE "ExamCredential" ADD CONSTRAINT "ExamCredential_emailStatus_check" CHECK ("emailStatus" IN ('pending', 'sent', 'failed', 'unavailable', 'unverified'));

CREATE TABLE "ExamCredentialSession" (
    "sessionId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "securityGeneration" INTEGER NOT NULL,
    CONSTRAINT "ExamCredentialSession_pkey" PRIMARY KEY ("sessionId")
);

CREATE UNIQUE INDEX "ExamCredential_examId_userId_key" ON "ExamCredential"("examId", "userId");
CREATE INDEX "ExamCredential_userId_revokedAt_idx" ON "ExamCredential"("userId", "revokedAt");
CREATE INDEX "ExamCredentialSession_credentialId_idx" ON "ExamCredentialSession"("credentialId");
ALTER TABLE "ExamCredential" ADD CONSTRAINT "ExamCredential_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamCredential" ADD CONSTRAINT "ExamCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamCredentialSession" ADD CONSTRAINT "ExamCredentialSession_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamCredentialSession" ADD CONSTRAINT "ExamCredentialSession_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "ExamCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE;
