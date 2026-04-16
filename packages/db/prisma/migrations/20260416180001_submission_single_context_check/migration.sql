-- Defense-in-depth: a Submission belongs to AT MOST one execution context
-- (assignment | exam | contest). The application-level guard in
-- createQueuedSubmissionRecord (active-exam lockout + payload-vs-context
-- exclusivity) is the primary enforcement; this constraint catches any
-- code path that bypasses the domain layer.
ALTER TABLE "Submission"
  ADD CONSTRAINT "Submission_single_context_chk"
  CHECK (
    (
      ("courseAssessmentId" IS NOT NULL)::int +
      ("examId" IS NOT NULL)::int +
      ("contestId" IS NOT NULL)::int
    ) <= 1
  );
