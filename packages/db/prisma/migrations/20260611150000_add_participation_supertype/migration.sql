-- CreateEnum
CREATE TYPE "ParticipationType" AS ENUM ('contest', 'exam', 'virtual');

-- CreateTable
CREATE TABLE "Participation" (
    "id" TEXT NOT NULL,
    "type" "ParticipationType" NOT NULL,
    "userId" TEXT NOT NULL,
    "contestId" TEXT,
    "examId" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "penaltySeconds" INTEGER NOT NULL DEFAULT 0,
    "subtaskScores" JSONB,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "typeData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Participation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Participation_userId_idx" ON "Participation"("userId");

-- CreateIndex
CREATE INDEX "Participation_contestId_idx" ON "Participation"("contestId");

-- CreateIndex
CREATE INDEX "Participation_examId_idx" ON "Participation"("examId");

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one context FK must match `type` (Prisma can't express CHECK constraints;
-- mirrors Submission_single_context_chk). `migrate diff` is blind to CHECKs, so this
-- does not register as schema drift.
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_single_context_chk" CHECK (
    ("type" = 'exam' AND "examId" IS NOT NULL AND "contestId" IS NULL)
    OR ("type" IN ('contest', 'virtual') AND "contestId" IS NOT NULL AND "examId" IS NULL)
);
