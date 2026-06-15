ALTER TYPE "CourseAssessmentStatus" RENAME TO "AssessmentStatus";

ALTER TABLE "CourseAssessment" RENAME TO "Assessment";
ALTER TABLE "CourseAssessmentProblem" RENAME TO "AssessmentProblem";

ALTER TABLE "Submission" RENAME COLUMN "courseAssessmentId" TO "assessmentId";
ALTER TABLE "SubmissionFeedback" RENAME COLUMN "courseAssessmentId" TO "assessmentId";
ALTER TABLE "SubmissionFeedbackAuditLog" RENAME COLUMN "courseAssessmentId" TO "assessmentId";

ALTER TABLE "Assessment" RENAME CONSTRAINT "CourseAssessment_pkey" TO "Assessment_pkey";
ALTER TABLE "Assessment" RENAME CONSTRAINT "CourseAssessment_courseId_fkey" TO "Assessment_courseId_fkey";
ALTER TABLE "Assessment" RENAME CONSTRAINT "CourseAssessment_createdByUserId_fkey" TO "Assessment_createdByUserId_fkey";
ALTER TABLE "Assessment" RENAME CONSTRAINT "CourseAssessment_plagiarismTriggeredById_fkey" TO "Assessment_plagiarismTriggeredById_fkey";

ALTER TABLE "AssessmentProblem" RENAME CONSTRAINT "CourseAssessmentProblem_pkey" TO "AssessmentProblem_pkey";
ALTER TABLE "AssessmentProblem" RENAME CONSTRAINT "CourseAssessmentProblem_assessmentId_fkey" TO "AssessmentProblem_assessmentId_fkey";
ALTER TABLE "AssessmentProblem" RENAME CONSTRAINT "CourseAssessmentProblem_problemId_fkey" TO "AssessmentProblem_problemId_fkey";

ALTER TABLE "Submission" RENAME CONSTRAINT "Submission_courseAssessmentId_fkey" TO "Submission_assessmentId_fkey";
ALTER TABLE "SubmissionFeedback" RENAME CONSTRAINT "SubmissionFeedback_courseAssessmentId_fkey" TO "SubmissionFeedback_assessmentId_fkey";

ALTER INDEX "CourseAssessment_courseId_status_idx" RENAME TO "Assessment_courseId_status_idx";
ALTER INDEX "CourseAssessmentProblem_assessmentId_ordinal_key" RENAME TO "AssessmentProblem_assessmentId_ordinal_key";
ALTER INDEX "CourseAssessmentProblem_assessmentId_problemId_key" RENAME TO "AssessmentProblem_assessmentId_problemId_key";
ALTER INDEX "Submission_courseId_courseAssessmentId_createdAt_idx" RENAME TO "Submission_courseId_assessmentId_createdAt_idx";
ALTER INDEX "SubmissionFeedback_courseAssessmentId_problemId_studentUser_key" RENAME TO "SubmissionFeedback_assessmentId_problemId_studentUserId_key";
ALTER INDEX "SubmissionFeedbackAuditLog_courseAssessmentId_problemId_cre_idx" RENAME TO "SubmissionFeedbackAuditLog_assessmentId_problemId_createdAt_idx";
