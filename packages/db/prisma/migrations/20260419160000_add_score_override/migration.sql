-- CreateEnum
CREATE TYPE "OverrideContextType" AS ENUM ('assignment', 'exam', 'contest');

-- CreateEnum
CREATE TYPE "ScoreOverrideAction" AS ENUM ('create', 'update', 'delete');

-- CreateTable
CREATE TABLE "ScoreOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "contextType" "OverrideContextType" NOT NULL,
    "contextId" TEXT NOT NULL,
    "overrideScore" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoreOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreOverrideAuditLog" (
    "id" TEXT NOT NULL,
    "overrideId" TEXT,
    "userId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "contextType" "OverrideContextType" NOT NULL,
    "contextId" TEXT NOT NULL,
    "action" "ScoreOverrideAction" NOT NULL,
    "oldScore" INTEGER,
    "newScore" INTEGER,
    "oldReason" TEXT,
    "newReason" TEXT,
    "changedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreOverrideAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScoreOverride_contextType_contextId_idx" ON "ScoreOverride"("contextType", "contextId");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreOverride_userId_problemId_contextType_contextId_key" ON "ScoreOverride"("userId", "problemId", "contextType", "contextId");

-- CreateIndex
CREATE INDEX "ScoreOverrideAuditLog_contextType_contextId_createdAt_idx" ON "ScoreOverrideAuditLog"("contextType", "contextId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ScoreOverrideAuditLog_userId_problemId_createdAt_idx" ON "ScoreOverrideAuditLog"("userId", "problemId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "ScoreOverride" ADD CONSTRAINT "ScoreOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreOverride" ADD CONSTRAINT "ScoreOverride_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreOverride" ADD CONSTRAINT "ScoreOverride_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreOverride" ADD CONSTRAINT "ScoreOverride_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreOverrideAuditLog" ADD CONSTRAINT "ScoreOverrideAuditLog_overrideId_fkey" FOREIGN KEY ("overrideId") REFERENCES "ScoreOverride"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreOverrideAuditLog" ADD CONSTRAINT "ScoreOverrideAuditLog_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
