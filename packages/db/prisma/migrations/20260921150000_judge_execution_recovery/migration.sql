-- CreateTable
CREATE TABLE "JudgeExecution" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "problemGeneration" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "queueClass" TEXT NOT NULL DEFAULT 'foreground',
    "operationId" TEXT,
    "workflowId" TEXT NOT NULL,
    "recoveryEpoch" INTEGER NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "reasonCode" TEXT,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastProgressAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "leaseOwner" TEXT,
    "oldStatus" TEXT NOT NULL,
    "oldScore" INTEGER NOT NULL,
    "rejudgeLogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JudgeExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JudgeStage" (
    "executionId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JudgeStage_pkey" PRIMARY KEY ("executionId","index")
);

-- CreateTable
CREATE TABLE "JudgeAdmission" (
    "id" TEXT NOT NULL,
    "cursor" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "JudgeAdmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JudgeExecution_workflowId_key" ON "JudgeExecution"("workflowId");

-- CreateIndex
CREATE INDEX "JudgeExecution_state_nextAttemptAt_queuedAt_idx" ON "JudgeExecution"("state", "nextAttemptAt", "queuedAt");

-- CreateIndex
CREATE INDEX "JudgeExecution_operationId_createdAt_id_idx" ON "JudgeExecution"("operationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "JudgeExecution_submissionId_generation_key" ON "JudgeExecution"("submissionId", "generation");

-- AddForeignKey
ALTER TABLE "JudgeExecution" ADD CONSTRAINT "JudgeExecution_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudgeStage" ADD CONSTRAINT "JudgeStage_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "JudgeExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
