-- CreateEnum
CREATE TYPE "ClarificationContextType" AS ENUM ('contest', 'exam', 'assignment');

-- CreateEnum
CREATE TYPE "ClarificationState" AS ENUM ('pending', 'answered', 'dismissed');

-- CreateTable
CREATE TABLE "Clarification" (
    "id" TEXT NOT NULL,
    "contextType" "ClarificationContextType" NOT NULL,
    "contextId" TEXT NOT NULL,
    "problemId" TEXT,
    "askedByUserId" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "answerText" TEXT,
    "state" "ClarificationState" NOT NULL DEFAULT 'pending',
    "answeredByUserId" TEXT,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Clarification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Clarification_contextType_contextId_createdAt_idx" ON "Clarification"("contextType", "contextId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Clarification_contextType_contextId_state_idx" ON "Clarification"("contextType", "contextId", "state");

-- CreateIndex
CREATE INDEX "Clarification_askedByUserId_createdAt_idx" ON "Clarification"("askedByUserId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Clarification" ADD CONSTRAINT "Clarification_askedByUserId_fkey" FOREIGN KEY ("askedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clarification" ADD CONSTRAINT "Clarification_answeredByUserId_fkey" FOREIGN KEY ("answeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clarification" ADD CONSTRAINT "Clarification_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
