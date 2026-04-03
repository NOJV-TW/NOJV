-- Add CHECK constraint to enforce submission context mutual exclusivity.
-- practice: no contestId, no courseAssessmentId
-- contest:  contestId required, no courseAssessmentId
-- assignment: courseAssessmentId required, no contestId
ALTER TABLE "Submission" ADD CONSTRAINT "submission_context_check" CHECK (
  CASE "mode"
    WHEN 'practice'   THEN "contestId" IS NULL AND "courseAssessmentId" IS NULL
    WHEN 'contest'    THEN "contestId" IS NOT NULL AND "courseAssessmentId" IS NULL
    WHEN 'assignment' THEN "courseAssessmentId" IS NOT NULL AND "contestId" IS NULL
    ELSE FALSE
  END
);
