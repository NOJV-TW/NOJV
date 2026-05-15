-- Optimistic-lock counter for ExamParticipation. Mirrors the column
-- added to ContestParticipation in 20260429000000 — concurrent score
-- recomputes for the same participation now do a versioned
-- read-modify-write instead of a last-writer-wins update.
ALTER TABLE "ExamParticipation" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

-- VirtualContest: one user's time-shifted personal re-run of a past
-- contest. The original contest is untouched; score/penalty here are
-- private to the virtual run.

-- CreateEnum
CREATE TYPE "VirtualContestStatus" AS ENUM ('active', 'finished');

-- CreateTable
CREATE TABLE "VirtualContest" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "VirtualContestStatus" NOT NULL DEFAULT 'active',
    "score" INTEGER NOT NULL DEFAULT 0,
    "penaltySeconds" INTEGER NOT NULL DEFAULT 0,
    "subtaskScores" JSONB,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VirtualContest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VirtualContest_contestId_userId_key" ON "VirtualContest"("contestId", "userId");

-- CreateIndex
CREATE INDEX "VirtualContest_userId_createdAt_idx" ON "VirtualContest"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "VirtualContest" ADD CONSTRAINT "VirtualContest_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualContest" ADD CONSTRAINT "VirtualContest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Submission.virtualContestId — virtual-contest submissions are
-- practice-like (excluded from the `Submission_single_context_chk`
-- mutual exclusion) but carry this tag so the personal re-run can
-- aggregate its own score.
ALTER TABLE "Submission" ADD COLUMN "virtualContestId" TEXT;

-- CreateIndex
CREATE INDEX "Submission_virtualContestId_problemId_createdAt_idx" ON "Submission"("virtualContestId", "problemId", "createdAt");

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_virtualContestId_fkey" FOREIGN KEY ("virtualContestId") REFERENCES "VirtualContest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
