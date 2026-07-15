ALTER TABLE "Submission"
  DROP CONSTRAINT "Submission_assessmentId_fkey",
  DROP CONSTRAINT "Submission_participationId_fkey";

ALTER TABLE "Submission"
  RENAME CONSTRAINT "Submission_assessment_course_fkey"
  TO "Submission_assessmentId_courseId_fkey";

ALTER TABLE "Submission"
  RENAME CONSTRAINT "Submission_participation_owner_fkey"
  TO "Submission_participationId_userId_fkey";
