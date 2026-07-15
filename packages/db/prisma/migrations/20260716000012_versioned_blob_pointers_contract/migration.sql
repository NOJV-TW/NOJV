-- expand-contract-ok: the release cutover applies 00011 alone, quiesces every
-- writer, backfills and verifies S3, then runs the DB preflight before Prisma is
-- allowed to see this migration. Keep the destructive DDL atomic; a failure
-- after this point intentionally leaves the release in maintenance mode.
BEGIN;

ALTER TABLE "Problem" VALIDATE CONSTRAINT "Problem_storage_accounting_chk";
ALTER TABLE "Submission" VALIDATE CONSTRAINT "Submission_judge_generation_chk";

ALTER TABLE "Testcase" ALTER COLUMN "inputStorage" SET NOT NULL;
ALTER TABLE "ProblemWorkspaceFile" ALTER COLUMN "contentStorage" SET NOT NULL;
ALTER TABLE "Submission" ALTER COLUMN "sourceStorage" SET NOT NULL;

ALTER TABLE "Testcase"
  ADD CONSTRAINT "Testcase_input_storage_pointer_chk"
  CHECK ("storage_pointer_valid"("inputStorage"));

ALTER TABLE "Testcase"
  ADD CONSTRAINT "Testcase_output_storage_pointer_chk"
  CHECK (
    "outputStorage" IS NULL
    OR "storage_pointer_valid"("outputStorage")
  );

ALTER TABLE "Testcase"
  ADD CONSTRAINT "Testcase_input_file_storage_pointer_chk"
  CHECK (
    "inputFileStorage" IS NULL
    OR "storage_pointer_map_valid"("inputFileStorage")
  );

ALTER TABLE "ProblemWorkspaceFile"
  ADD CONSTRAINT "ProblemWorkspaceFile_content_storage_pointer_chk"
  CHECK ("storage_pointer_valid"("contentStorage"));

ALTER TABLE "Submission"
  ADD CONSTRAINT "Submission_source_storage_pointer_chk"
  CHECK ("storage_pointer_valid"("sourceStorage"));

ALTER TABLE "Submission"
  ADD CONSTRAINT "Submission_verdict_storage_pointer_chk"
  CHECK (
    "verdictDetailStorage" IS NULL
    OR "storage_pointer_valid"("verdictDetailStorage")
  );

ALTER TABLE "Problem"
  ADD CONSTRAINT "Problem_checker_storage_pointer_chk"
  CHECK (
    "checkerStorage" IS NULL
    OR "storage_pointer_valid"("checkerStorage")
  );

ALTER TABLE "Problem"
  ADD CONSTRAINT "Problem_interactor_storage_pointer_chk"
  CHECK (
    "interactorStorage" IS NULL
    OR "storage_pointer_valid"("interactorStorage")
  );

ALTER TABLE "Testcase"
  DROP COLUMN "inputKey",
  DROP COLUMN "outputKey",
  DROP COLUMN "inputFileKeys";

ALTER TABLE "ProblemWorkspaceFile" DROP COLUMN "contentKey";

ALTER TABLE "Submission"
  DROP COLUMN "sourceStoragePrefix",
  DROP COLUMN "verdictDetailStorageKey";

COMMIT;
