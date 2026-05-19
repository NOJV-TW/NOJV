-- CreateTable
CREATE TABLE "SubmissionFeedback" (
    "id" TEXT NOT NULL,
    "studentUserId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "courseAssessmentId" TEXT,
    "examId" TEXT,
    "comment" TEXT NOT NULL,
    "authorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubmissionFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionFeedback_courseAssessmentId_problemId_studentUser_key" ON "SubmissionFeedback"("courseAssessmentId", "problemId", "studentUserId");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionFeedback_examId_problemId_studentUserId_key" ON "SubmissionFeedback"("examId", "problemId", "studentUserId");

-- AddForeignKey
ALTER TABLE "SubmissionFeedback" ADD CONSTRAINT "SubmissionFeedback_studentUserId_fkey" FOREIGN KEY ("studentUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionFeedback" ADD CONSTRAINT "SubmissionFeedback_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionFeedback" ADD CONSTRAINT "SubmissionFeedback_courseAssessmentId_fkey" FOREIGN KEY ("courseAssessmentId") REFERENCES "CourseAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionFeedback" ADD CONSTRAINT "SubmissionFeedback_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionFeedback" ADD CONSTRAINT "SubmissionFeedback_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Defense-in-depth: a SubmissionFeedback row belongs to EXACTLY one
-- grading context (assignment | exam). Contest is intentionally
-- excluded. The domain layer is the primary enforcement; this
-- constraint catches any code path that bypasses it.
ALTER TABLE "SubmissionFeedback"
  ADD CONSTRAINT "SubmissionFeedback_single_context_chk"
  CHECK (
    (("courseAssessmentId" IS NOT NULL)::int +
     ("examId" IS NOT NULL)::int) = 1
  );
