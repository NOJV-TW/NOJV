-- Pair-level "false positive" flags for the Dolos plagiarism report.
-- The report itself lives inline on Exam/CourseAssessment and is wiped on
-- every re-run; flag rows survive across re-runs because pairKey is a
-- deterministic, server-computed string.

-- CreateEnum
CREATE TYPE "PlagiarismContext" AS ENUM ('assessment', 'exam', 'contest');

-- CreateTable
CREATE TABLE "PlagiarismPairFlag" (
    "id" TEXT NOT NULL,
    "contextType" "PlagiarismContext" NOT NULL,
    "contextId" TEXT NOT NULL,
    "pairKey" TEXT NOT NULL,
    "flaggedBy" TEXT NOT NULL,
    "flaggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "PlagiarismPairFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlagiarismPairFlag_contextType_contextId_pairKey_key" ON "PlagiarismPairFlag"("contextType", "contextId", "pairKey");

-- CreateIndex
CREATE INDEX "PlagiarismPairFlag_contextType_contextId_idx" ON "PlagiarismPairFlag"("contextType", "contextId");

-- AddForeignKey
ALTER TABLE "PlagiarismPairFlag" ADD CONSTRAINT "PlagiarismPairFlag_flaggedBy_fkey" FOREIGN KEY ("flaggedBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
