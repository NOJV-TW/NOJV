
-- CreateTable
CREATE TABLE "JudgeExecutionObject" (
    "executionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,

    CONSTRAINT "JudgeExecutionObject_pkey" PRIMARY KEY ("executionId","key")
);

-- CreateIndex
CREATE INDEX "JudgeExecutionObject_key_idx" ON "JudgeExecutionObject"("key");

-- AddForeignKey
ALTER TABLE "JudgeExecutionObject" ADD CONSTRAINT "JudgeExecutionObject_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "JudgeExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
