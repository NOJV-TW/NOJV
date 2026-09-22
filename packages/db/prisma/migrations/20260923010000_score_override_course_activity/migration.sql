-- expand-contract-ok: contests no longer take score overrides, and the override tables move to the same assignment/exam foreign keys as SubmissionFeedback. Production holds no ScoreOverride rows and the release runs inside the migration maintenance window, so the polymorphic context columns, the user subject and the enum leave in one step.
DELETE FROM "ScoreOverrideAuditLog" WHERE "contextType" = 'contest';
DELETE FROM "ScoreOverride" WHERE "contextType" = 'contest';

ALTER TABLE "ScoreOverride" DROP CONSTRAINT "ScoreOverride_subject_chk";
ALTER TABLE "ScoreOverride" DROP CONSTRAINT "ScoreOverride_courseMembershipId_problemId_contextType_cont_key";
DROP INDEX "ScoreOverride_userId_problemId_contextType_contextId_key";
DROP INDEX "ScoreOverride_contextType_contextId_idx";
ALTER TABLE "ScoreOverride" DROP COLUMN "userId";
ALTER TABLE "ScoreOverride" ADD COLUMN "assessmentId" TEXT, ADD COLUMN "examId" TEXT;
UPDATE "ScoreOverride" o SET "assessmentId" = o."contextId"
  WHERE o."contextType" = 'assignment' AND EXISTS (SELECT 1 FROM "Assessment" a WHERE a."id" = o."contextId");
UPDATE "ScoreOverride" o SET "examId" = o."contextId"
  WHERE o."contextType" = 'exam' AND EXISTS (SELECT 1 FROM "Exam" e WHERE e."id" = o."contextId");
DELETE FROM "ScoreOverride" WHERE "courseMembershipId" IS NULL OR ("assessmentId" IS NULL AND "examId" IS NULL);
ALTER TABLE "ScoreOverride" DROP COLUMN "contextType", DROP COLUMN "contextId";
ALTER TABLE "ScoreOverride" ALTER COLUMN "courseMembershipId" SET NOT NULL;
ALTER TABLE "ScoreOverride" ADD CONSTRAINT "ScoreOverride_assessmentId_fkey"
  FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScoreOverride" ADD CONSTRAINT "ScoreOverride_examId_fkey"
  FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScoreOverride" ADD CONSTRAINT "ScoreOverride_assessmentId_problemId_courseMembershipId_key"
  UNIQUE ("assessmentId", "problemId", "courseMembershipId");
ALTER TABLE "ScoreOverride" ADD CONSTRAINT "ScoreOverride_examId_problemId_courseMembershipId_key"
  UNIQUE ("examId", "problemId", "courseMembershipId");
ALTER TABLE "ScoreOverride" ADD CONSTRAINT "ScoreOverride_single_context_chk"
  CHECK (
    (("assessmentId" IS NOT NULL)::int +
     ("examId" IS NOT NULL)::int) = 1
  );

DROP INDEX "ScoreOverrideAuditLog_contextType_contextId_createdAt_idx";
DROP INDEX "ScoreOverrideAuditLog_userId_problemId_createdAt_idx";
ALTER TABLE "ScoreOverrideAuditLog" RENAME COLUMN "userId" TO "studentUserId";
ALTER TABLE "ScoreOverrideAuditLog" ADD COLUMN "assessmentId" TEXT, ADD COLUMN "examId" TEXT;
UPDATE "ScoreOverrideAuditLog" SET "assessmentId" = "contextId" WHERE "contextType" = 'assignment';
UPDATE "ScoreOverrideAuditLog" SET "examId" = "contextId" WHERE "contextType" = 'exam';
ALTER TABLE "ScoreOverrideAuditLog" DROP COLUMN "contextType", DROP COLUMN "contextId";
ALTER TABLE "ScoreOverrideAuditLog" ADD CONSTRAINT "ScoreOverrideAuditLog_single_context_chk"
  CHECK (
    (("assessmentId" IS NOT NULL)::int +
     ("examId" IS NOT NULL)::int) = 1
  );

DROP TYPE "OverrideContextType";
