-- CreateEnum
CREATE TYPE "SubmissionFeedbackAction" AS ENUM ('create', 'update', 'delete');

-- CreateTable
CREATE TABLE "SubmissionFeedbackAuditLog" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT,
    "studentUserId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "courseAssessmentId" TEXT,
    "examId" TEXT,
    "action" "SubmissionFeedbackAction" NOT NULL,
    "oldComment" TEXT,
    "newComment" TEXT,
    "changedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionFeedbackAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubmissionFeedbackAuditLog_courseAssessmentId_problemId_cre_idx" ON "SubmissionFeedbackAuditLog"("courseAssessmentId", "problemId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SubmissionFeedbackAuditLog_examId_problemId_createdAt_idx" ON "SubmissionFeedbackAuditLog"("examId", "problemId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SubmissionFeedbackAuditLog_studentUserId_problemId_createdA_idx" ON "SubmissionFeedbackAuditLog"("studentUserId", "problemId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "SubmissionFeedbackAuditLog" ADD CONSTRAINT "SubmissionFeedbackAuditLog_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "SubmissionFeedback"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionFeedbackAuditLog" ADD CONSTRAINT "SubmissionFeedbackAuditLog_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SubmissionFeedbackAuditLog"
  ADD CONSTRAINT "SubmissionFeedbackAuditLog_single_context_chk"
  CHECK (
    (("courseAssessmentId" IS NOT NULL)::int +
     ("examId" IS NOT NULL)::int) = 1
  );

-- CreateTable
CREATE TABLE "PlagiarismTriggerLog" (
    "id" TEXT NOT NULL,
    "contextType" "PlagiarismContext" NOT NULL,
    "contextId" TEXT NOT NULL,
    "triggeredByUserId" TEXT,
    "priorPairCount" INTEGER NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlagiarismTriggerLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlagiarismTriggerLog_contextType_contextId_triggeredAt_idx" ON "PlagiarismTriggerLog"("contextType", "contextId", "triggeredAt" DESC);

-- AddForeignKey
ALTER TABLE "PlagiarismTriggerLog" ADD CONSTRAINT "PlagiarismTriggerLog_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
