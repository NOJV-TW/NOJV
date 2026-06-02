-- CreateTable
CREATE TABLE "ProblemBookmark" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProblemBookmark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProblemBookmark_userId_problemId_key" ON "ProblemBookmark"("userId", "problemId");

-- CreateIndex
CREATE INDEX "ProblemBookmark_userId_createdAt_idx" ON "ProblemBookmark"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProblemBookmark" ADD CONSTRAINT "ProblemBookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemBookmark" ADD CONSTRAINT "ProblemBookmark_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
